/**
 * Single source of truth for whether a post is readable yet.
 *
 * Two separate things can lock a post:
 *
 *  1. Its pubDate is in the future. This is the normal scheduled release,
 *     and the hub card shows the date it lands on.
 *  2. `hold: true` in its frontmatter. This is an editorial hold: the post
 *     is finished enough to sit in the repo but is not going out yet, and
 *     there is no honest date to show. The card says "Coming soon".
 *
 * The hold exists because the alternative was pushing pubDate years into
 * the future to keep an article back, which put a release date on the page
 * that nobody intended to keep.
 */

export type ReleaseData = {
  pubDate: Date;
  hold?: boolean;
};

export type ReleasePost = { data: ReleaseData };

/** Midnight UTC today. Every comparison below uses the same instant. */
export function releaseToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

/** True when the post is held back by an editorial hold, date aside. */
export function isHeld(post: ReleasePost): boolean {
  return post.data.hold === true;
}

/** True when the post is not readable yet, for either reason. */
export function isLocked(post: ReleasePost, today: Date = releaseToday()): boolean {
  return isHeld(post) || post.data.pubDate > today;
}

/** True when the post is readable now. */
export function isReleased(post: ReleasePost, today: Date = releaseToday()): boolean {
  return !isLocked(post, today);
}

/**
 * True when the post is locked but has a real date to count down to.
 *
 * The "next release" boxes use this rather than isLocked. A held post has no
 * date anyone intends to keep, and a held post with a past pubDate would
 * otherwise sort to the front and advertise a release date that has already
 * been and gone.
 */
export function isScheduled(post: ReleasePost, today: Date = releaseToday()): boolean {
  return !isHeld(post) && post.data.pubDate > today;
}

/**
 * What a locked card should say. A held post has no date worth showing, so
 * it gets "Coming soon"; a scheduled one gets the date it lands on.
 */
export function lockLabel(post: ReleasePost): string {
  if (isHeld(post)) return 'Coming soon';
  return `Releases ${post.data.pubDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;
}
