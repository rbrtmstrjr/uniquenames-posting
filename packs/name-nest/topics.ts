import type { ReelFormat } from "@/lib/reels/formats";
import type { ReelTopic } from "@/lib/reels/topics";
import { UNIQUE_NAMES_TOPICS } from "../unique-names/topics";

// Name Nest reel topic bank (US only). It starts from the researched bank (its topics, vetted facts and anchors are
// already plain American-readable English), drops what does not fit a US page, and adds US-family topics: daycare,
// car seats, the US holidays and seasons, the school year. Health topics carry vetted facts + a safety line.

const T = (id: string, topic: string, format: ReelFormat, health = false, stage?: ReelTopic["stage"], extra: Partial<ReelTopic> = {}): ReelTopic =>
  ({ id, topic, format, health, ...(stage ? { stage } : {}), ...extra });

/** Dropped from the shared bank: framed for parents overseas (the US bank has travel-for-work and deployment instead). */
const DROPPED = new Set(["parent-abroad"]);

/**
 * Vetted facts for the US topics. Sources (checked 2026-10-10, AAP HealthyChildren.org):
 * - Car seats: "Car Seats: Information for Families" https://www.healthychildren.org/English/safety-prevention/on-the-go/Pages/Car-Safety-Seats-Information-for-Families.aspx
 *   ("should continue to ride in a rear facing seat as long as possible"; "infants in rear-facing seats must ride in
 *   the back seat" with a front passenger airbag; "All children younger than 13 years should ride in the back seat";
 *   the harness snug: "you cannot pinch any slack").
 * - Winter coats: "Winter Car Seat Safety Tips" https://www.healthychildren.org/English/safety-prevention/on-the-go/Pages/Winter-Car-Seat-Safety-Tips.aspx
 *   ("bulky clothing, including winter coats and snowsuits, should not be worn underneath the harness"; "Dress your
 *   child in thin layers"; "add a blanket over the top of the harness straps"; the pinch test).
 * - Hot cars: "Prevent Child Deaths in Hot Cars" https://www.healthychildren.org/English/safety-prevention/on-the-go/Pages/Prevent-Child-Deaths-in-Hot-Cars.aspx
 *   ("NOT safe to leave a young child alone in a car for any length of time"; "In just 10 minutes, a car can heat up 20
 *   degrees F"; "A child's body heats up 3 to 5 times faster than an adult's"; phone or bag in the back seat; child care
 *   calls if late; keep the car locked).
 * - Halloween: "Halloween Safety Tips" https://www.healthychildren.org/English/safety-prevention/all-around/Pages/Halloween-Safety-Tips.aspx
 *   (a good meal first; sort and check treats at home; ration treats for the days and weeks after; wrappers, stickers
 *   and small toys can be a choking hazard; bright, reflective costumes; flashlights after dark).
 * - Water: "Water Safety and Young Children" https://www.healthychildren.org/English/safety-prevention/at-play/Pages/Water-Safety-And-Young-Children.aspx
 *   (full attention; an assigned "water watcher"; arm's length "touch supervision"; a fence on all 4 sides, at least 4
 *   feet high; swim lessons after the first birthday depending on readiness; life jackets in lakes and rivers).
 * - Sun: "Sun Safety" https://www.healthychildren.org/English/safety-prevention/at-play/Pages/Sun-Safety.aspx
 *   (babies under 6 months out of direct sunlight; shade; sunscreen on small areas if clothing and shade are not
 *   available; SPF 15 or more; reapply every 2 hours and after swimming; a hat with a 3-inch brim).
 * - Fireworks: "Stay Safe This 4th of July" https://www.healthychildren.org/English/safety-prevention/at-play/Pages/stay-safe-this-4th-of-july.aspx
 *   (sparklers burn at 2,000 degrees Fahrenheit; nearly half of fireworks injuries to children under 5 are from
 *   sparklers; professional shows are safer; let kids wave a flag or glow stick; fireworks can be as loud as 150 decibels).
 * - Sleep: the shared bank's "Healthy Sleep Habits" facts.
 */
const CAR_SEAT_SAFETY = "Questions about your child's car seat? Ask your pediatrician or a certified car seat technician.";
const SLEEP_FACTS = [
  "A simple bedtime routine, the same every night (like brush, book, bed), helps young children settle.",
  "Waking up at the same time every day helps bedtime go smoothly.",
  "Turning screens off at least an hour before bed helps children fall asleep.",
];
const SLEEP_SAFETY = "If sleep troubles go on for weeks, talk to your pediatrician.";

const US_TOPICS: ReelTopic[] = [
  // Daycare, preschool and the school year
  T("daycare-dropoff", "Daycare drop-off tears: a short, sweet goodbye ritual that makes mornings easier", "named_method", false, "toddler"),
  T("pickup-meltdown", "Why your toddler melts down at daycare pickup (they held it together all day for you)", "problem_fix", false, "toddler"),
  T("kindergarten-first-day", "First day of kindergarten: 3 things to say instead of \"Don't be scared\"", "say_this", false, "preschooler"),
  T("back-to-school-mornings", "Back-to-school mornings: the night-before routine that ends the 7 a.m. scramble", "problem_fix", false, "preschooler"),
  T("working-mom-guilt", "Working mom guilt at daycare: what your little one really remembers about your day", "scene_lesson", false, "toddler"),
  // Car seats and the car (vetted HealthyChildren facts)
  T("car-seat-basics", "Car seat basics pediatricians want every parent to know", "problem_fix", true, "baby", {
    facts: [
      "Babies and toddlers should ride rear-facing as long as possible, until they reach their seat's top weight or height.",
      "A baby in a rear-facing seat never rides in front of an active airbag: the back seat is the place.",
      "All children younger than 13 should ride in the back seat.",
      "The harness should be snug: you shouldn't be able to pinch any slack in the straps.",
    ],
    safety: CAR_SEAT_SAFETY,
  }),
  T("puffy-coat-car-seat", "Puffy coat in the car seat? The quick winter swap that keeps the straps snug", "problem_fix", true, "toddler", {
    facts: [
      "Winter coats and snowsuits shouldn't be worn under the car seat harness: they squish down in a crash.",
      "Dress your child in thin layers for the ride.",
      "Buckle first, then lay the coat or a blanket over the straps.",
      "If you can pinch the harness straps, tighten them.",
    ],
    safety: CAR_SEAT_SAFETY,
  }),
  T("look-before-you-lock", "Never leave a child alone in the car, not even for a minute: the back-seat habit", "named_method", true, "baby", {
    facts: [
      "It's never safe to leave a young child alone in a car, for any length of time.",
      "In just 10 minutes, a car can heat up 20 degrees Fahrenheit.",
      "A child's body heats up 3 to 5 times faster than an adult's.",
      "Put your phone or bag in the back seat, so you always check the back seat before you lock up.",
      "Ask your child care provider to call you if your child is more than 10 minutes late.",
    ],
    safety: "See a child alone in a hot car? Call 911 right away.",
  }),
  T("road-trip-toddler", "Long car rides with a toddler: a little bag of surprises and a stop-and-stretch rhythm", "problem_fix", false, "toddler"),
  // US holidays
  T("halloween-candy", "Halloween candy: a calm plan instead of a candy battle", "named_method", true, "preschooler", {
    facts: [
      "A good meal before trick-or-treating helps kids skip snacking on the way.",
      "Sort and check every treat at home, and toss anything unwrapped or open.",
      "Spread the treats out over the days and weeks after Halloween.",
      "Candy wrappers, stickers and small toys can be a choking hazard for little ones.",
      "Bright, reflective costumes and a flashlight help kids be seen after dark.",
    ],
    safety: "Worried your child choked on something or ate something unsafe? Call your pediatrician, or 911 in an emergency.",
  }),
  T("thanksgiving-toddler", "Thanksgiving with a toddler: 3 ways to keep the big dinner calm", "named_method", false, "toddler"),
  T("holiday-gifts", "Too many gifts at Christmas? The 4-gift rule for little kids: want, need, wear, read", "named_method", false, "preschooler"),
  T("fourth-of-july-sparklers", "Fourth of July with little kids: why a sparkler isn't a toddler toy", "problem_fix", true, "toddler", {
    facts: [
      "Sparklers burn at about 2,000 degrees Fahrenheit.",
      "Nearly half of fireworks injuries to children under 5 come from sparklers.",
      "Professional fireworks shows are safer than backyard fireworks.",
      "Let little kids wave a flag or a glow stick instead of a sparkler.",
      "Fireworks can be loud enough to hurt young ears, so watch from a good distance.",
    ],
    safety: "A burn or an eye injury from fireworks? Get medical care right away.",
  }),
  // Seasons
  T("pool-water-watcher", "Pool days with little kids: the Water Watcher rule", "named_method", true, "toddler", {
    facts: [
      "Whenever your toddler is in or near water, give them your full attention.",
      "At parties and picnics, pick one adult as the water watcher, eyes on the kids the whole time.",
      "Stay within arm's reach of young children in the bath and in the pool.",
      "A home pool should have a fence on all 4 sides, at least 4 feet high.",
      "Children can start swim lessons after their first birthday, when they're ready.",
    ],
    safety: "A child pulled from the water and not breathing normally? Call 911 right away.",
  }),
  T("baby-sun-shade", "Summer sun and babies under 6 months: shade first, then the rest", "problem_fix", true, "baby", {
    facts: [
      "Keep babies younger than 6 months out of direct sunlight: a tree, an umbrella or the stroller canopy.",
      "If clothing and shade aren't possible, a little sunscreen on small areas like the face is OK.",
      "For older babies and kids, use sunscreen with SPF 15 or higher.",
      "Put sunscreen on again every 2 hours and after swimming.",
      "A hat with a wide brim shades the face, ears and neck.",
    ],
    safety: "A sunburn with blisters, fever or a baby who seems sick? Call your pediatrician.",
  }),
  T("daylight-saving-bedtime", "Daylight saving time and bedtime: how to shift your little one's sleep gently", "problem_fix", true, "toddler", {
    facts: SLEEP_FACTS, safety: SLEEP_SAFETY,
  }),
  T("summer-bedtime-light", "Bedtime when it's still light out at 8 p.m.: summer sleep that still works", "problem_fix", true, "toddler", {
    facts: SLEEP_FACTS, safety: SLEEP_SAFETY,
  }),
  T("snow-day", "Snow day with a toddler and nowhere to go: the slow-morning plan", "scene_lesson", false, "toddler"),
  // Everyday American errands
  T("checkout-meltdown", "Meltdown in the checkout line: a calm 3-step exit plan", "problem_fix", false, "toddler"),
];

/** The bank: the shared researched topics (minus the dropped ones) and the US topics. */
export const NAME_NEST_TOPICS: ReelTopic[] = [...UNIQUE_NAMES_TOPICS.filter((t) => !DROPPED.has(t.id)), ...US_TOPICS];
