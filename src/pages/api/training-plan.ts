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
          max_tokens: 3000,
        });
      } catch (error: any) {
        if (error?.code === 'model_not_found' && configuredModel !== fallbackModel) {
          response = await openaiClient.chat.completions.create({
            model: fallbackModel,
            messages,
            temperature: 0.7,
            max_tokens: 3000,
          });
        } else {
          throw error;
        }
      }

      generatedPlan = response.choices[0]?.message?.content || '';
    }

    // Direct submission (no mailto flow): request is received server-side here.
    // You can later wire this to DB storage or an email provider from this endpoint.
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
  } catch (error) {
    console.error('Consultation submission error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process consultation request' }),
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
