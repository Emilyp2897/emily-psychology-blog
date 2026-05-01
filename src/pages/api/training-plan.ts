import type { APIRoute } from 'astro';
import { default as OpenAI } from 'openai';

export const prerender = false;

interface ConsultationWithPlanRequest {
  name: string;
  email: string;
  phone?: string;
  sport: string;
  contactMethod: string;
  preferredTime?: string;
  goals: string;
  // Progression plan fields
  includeProgressionPlan: boolean;
  age?: number;
  height?: string;
  weight?: string;
  exerciseLevel?: string;
  sportsOrNot?: string;
  equipment?: string[];
  frequencyPerWeek?: number;
  planDuration?: string;
  planGoals?: string[];
  issuesWorries?: string;
  lifestyle?: string;
  medicalConditions?: string;
  injuries?: string;
}

const openaiClient = new OpenAI({
  apiKey: import.meta.env.OPENAI_API_KEY,
});

const CONSULTATION_TO_EMAIL = 'emilyphelan@mindthegael.co.uk';

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json() as ConsultationWithPlanRequest;

    // Validate required fields
    if (!body.name || !body.email || !body.sport || !body.goals) {
      return new Response(
        JSON.stringify({ error: 'Missing required consultation fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let generatedPlan = '';

    // Generate progression plan if requested
    if (body.includeProgressionPlan && body.age && body.frequencyPerWeek && body.planGoals?.length) {
      const prompt = buildPlanPrompt({
        age: body.age,
        height: body.height || '',
        weight: body.weight || '',
        exerciseLevel: body.exerciseLevel || '',
        sportsOrNot: body.sportsOrNot || '',
        equipment: body.equipment || [],
        frequencyPerWeek: body.frequencyPerWeek,
        planDuration: body.planDuration || '6 weeks',
        goals: body.planGoals || [],
        issuesWorries: body.issuesWorries || '',
        lifestyle: body.lifestyle || '',
        medicalConditions: body.medicalConditions || '',
        injuries: body.injuries || '',
      });

      const configuredModel = import.meta.env.OPENAI_MODEL_PLAN || import.meta.env.OPENAI_MODEL || 'gpt-4.1-mini';
      const fallbackModel = 'gpt-4.1-mini';
      const messages = [
        {
          role: 'system' as const,
          content: `You are an expert strength and conditioning coach specializing in women's health and athletic performance. 
You create personalized 6-week training progression plans that are practical, safe, and adaptable.
Your plans balance progressive overload, recovery, and individual constraints.
Always consider cycle awareness and long-term athlete development.`
        },
        {
          role: 'user' as const,
          content: prompt
        }
      ];

      let response;
      try {
        response = await openaiClient.chat.completions.create({
          model: configuredModel,
          messages,
          temperature: 0.7,
          max_tokens: 1400,
        });
      } catch (error: any) {
        if (error?.code === 'model_not_found' && configuredModel !== fallbackModel) {
          response = await openaiClient.chat.completions.create({
            model: fallbackModel,
            messages,
            temperature: 0.7,
            max_tokens: 1400,
          });
        } else {
          throw error;
        }
      }

      generatedPlan = response.choices[0]?.message?.content || '';
    }

    // Direct submission (no mailto flow): request is received server-side here.
    await sendConsultationEmail(body, generatedPlan);

    console.log('[CONSULTATION_REQUEST]', {
      name: body.name,
      email: body.email,
      timestamp: new Date().toISOString(),
      hasProgressionPlan: body.includeProgressionPlan && !!generatedPlan,
      planDuration: body.planDuration || 'not provided',
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Your consultation request has been received. I will review your details and any custom progression plan within 48 hours and be in touch.'
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('Consultation submission error:', error);
    let message = 'Failed to process consultation request.';

    if (error?.message?.includes('RESEND_API_KEY')) {
      message = 'Consultation email service is not configured yet. Please add RESEND_API_KEY in environment variables.';
    } else if (error?.message?.includes('Failed to send consultation email')) {
      message = 'Could not send consultation email. Please check that your Resend sender email/domain is verified.';
    } else if (error?.code === 'insufficient_quota') {
      message = 'AI quota limit reached. Your request details were received, but plan generation could not complete right now.';
    } else if (error?.code === 'model_not_found') {
      message = 'Configured AI model is not available for this API key. Please update OPENAI_MODEL_PLAN.';
    }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

function buildPlanPrompt(data: any): string {
  return `Create a personalized ${data.planDuration || '6-week'} strength and conditioning progression plan for the following client:

CLIENT PROFILE:
- Age: ${data.age}
- Height: ${data.height}
- Weight: ${data.weight}
- Exercise experience level: ${data.exerciseLevel}
- Sports background: ${data.sportsOrNot}
- Available equipment: ${data.equipment.join(', ') || 'None specified'}
- Training frequency: ${data.frequencyPerWeek} sessions per week
- Plan duration: ${data.planDuration || '6 weeks'}
- Goals: ${data.goals.join(', ')}
- Issues/concerns/worries: ${data.issuesWorries || 'None specified'}
- Lifestyle: ${data.lifestyle}
- Medical conditions: ${data.medicalConditions || 'None'}
- Injuries/limitations: ${data.injuries || 'None'}

Please provide the plan in the following structure:

## CLIENT VERSION
[Training schedule and exercise guide written in an encouraging, accessible tone for the client]

For each week, include:
- Weekly overview (focus, intensity)
- Sessions breakdown with exercises, sets, reps, and intensity guidance (RPE or % 1RM)
- Rest/deload weeks as appropriate
- Progression cues and when to increase load
- Practical tips for execution

## COACH VERSION
[Detailed coaching notes including progression logic, adjustments, and monitoring points]

Include:
- Progression rationale and key milestones
- Exercises variations and substitutions based on equipment
- When to progress, plateau, or deload based on client feedback
- Monitoring points (RPE feedback, movement quality, recovery)
- Contingency adjustments if client struggles or exceeds expectations
- Integration notes if they're training for a specific sport

Make the plan progressive (each week builds on previous) and adaptable to the client's actual capacity over ${data.planDuration || '6 weeks'}.`;
}

async function sendConsultationEmail(data: ConsultationWithPlanRequest, generatedPlan: string) {
  const resendApiKey = import.meta.env.RESEND_API_KEY;
  const fromEmail = import.meta.env.CONSULTATION_FROM_EMAIL || 'Mind the Gael <onboarding@resend.dev>';

  if (!resendApiKey) {
    throw new Error('Missing RESEND_API_KEY environment variable.');
  }

  const subject = `New consultation request: ${data.name}`;
  const planBlock = generatedPlan
    ? `\n\nAI-GENERATED PLAN\n----------------\n${generatedPlan}`
    : '\n\nAI-GENERATED PLAN\n----------------\nNo plan generated for this submission.';

  const text = [
    'NEW CONSULTATION REQUEST',
    '',
    `Submitted: ${new Date().toISOString()}`,
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone || 'Not provided'}`,
    `Sport/Team: ${data.sport}`,
    `Preferred contact method: ${data.contactMethod}`,
    `Preferred time: ${data.preferredTime || 'Not provided'}`,
    '',
    'CLIENT GOALS',
    '------------',
    data.goals,
    '',
    'TRAINING PLAN INPUT',
    '-------------------',
    `Include progression plan: ${data.includeProgressionPlan ? 'Yes' : 'No'}`,
    `Age: ${data.age ?? 'Not provided'}`,
    `Height: ${data.height || 'Not provided'}`,
    `Weight: ${data.weight || 'Not provided'}`,
    `Exercise level: ${data.exerciseLevel || 'Not provided'}`,
    `Sports background: ${data.sportsOrNot || 'Not provided'}`,
    `Equipment: ${data.equipment?.join(', ') || 'Not provided'}`,
    `Frequency per week: ${data.frequencyPerWeek ?? 'Not provided'}`,
    `Plan duration: ${data.planDuration || 'Not provided'}`,
    `Plan goals: ${data.planGoals?.join(', ') || 'Not provided'}`,
    `Issues/worries: ${data.issuesWorries || 'Not provided'}`,
    `Lifestyle: ${data.lifestyle || 'Not provided'}`,
    `Medical conditions: ${data.medicalConditions || 'Not provided'}`,
    `Injuries: ${data.injuries || 'Not provided'}`,
  ].join('\n') + planBlock;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [CONSULTATION_TO_EMAIL],
      subject,
      text,
      reply_to: data.email,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => 'No response body');
    throw new Error(`Failed to send consultation email: ${response.status} ${details}`);
  }
}
