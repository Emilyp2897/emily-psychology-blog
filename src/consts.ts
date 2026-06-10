// Place any global data in this file.
// You can import this data from anywhere in your site by using the import keyword.
export const SITE_TITLE = 'Mind the Gael';
export const SITE_DESCRIPTION = 'Online performance plans for female athletes. Mental performance, physical training, and women\'s health all in one place, built around your sport and your goals.';
// Used on the homepage and as the og:title default. Longer than SITE_TITLE
// because it includes the tagline that Google shows in search results. Per
// page titles still use SITE_TITLE so they stay concise (e.g. "Performance
// Plans | Mind the Gael").
export const SITE_TITLE_FULL = 'Mind the Gael | Mental Performance for Female Athletes';
// Emily's Google Calendar appointment scheduler. Used in two places:
// 1. The personal-training page embeds this for booking "discuss your plan" chats.
// 2. The auto-sent plan email (training-plan.ts) includes this link so clients
//    can book a follow-up chat once they receive their plan.
export const EMILY_CALENDAR_BOOKING_URL =
'https://calendar.google.com/calendar/appointments/schedules/AcZssZ36KoXqM3BjxB0kIH_OIVYVykacTIuW9-AJsezyfpalTSLO0YwC2h4FqPox3L4zBGQASYd-Ya4B?gv=true';