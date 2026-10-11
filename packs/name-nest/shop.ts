import type { PackShop } from "../types";

// Name Nest (@namenest): the names PDF shop, OFF for now (owner, 2026-10-11). Warm American English, ready for later.
// PayMongo charges in PHP only; a US shop needs another provider or currency before it is switched on.

export const NAME_NEST_SHOP: PackShop = {
  enabled: false,
  currency: "PHP",
  locale: "en-US",
  products: {
    girl: { name: "Girl Names Edition", price: 5000, blurb: "Every girl name on our list, with meanings and origins." },
    boy: { name: "Boy Names Edition", price: 5000, blurb: "Every boy name on our list, with meanings and origins." },
    both: { name: "Girl & Boy Bundle", price: 10000, blurb: "Both editions in one PDF, for team green.", badge: "Best value" },
  },
  productOrder: ["girl", "boy", "both"],
  paymentMethods: ["qrph"],
  messenger: null,
  delivery: { email: true, messenger: false },
  previews: null,
  gallery: null, // no photos yet: the shop shows its plain background
  copy: {
    metaTitle: "The Name Nest Collection (PDF)",
    metaDescription: "Hand-picked baby names with meanings and origins, in one cozy printable PDF. Instant download.",
    eyebrow: "The Name Nest Collection",
    title: "Your shortlist starts here",
    subtitle: "Every name on our list in one cozy, printable PDF, with the meaning (and origin) of each one. Download it right after checkout.",
    insideHeading: "What's inside",
    inside: [
      "{girl} girl names and {boy} boy names, each with its meaning.",
      "Single names first, then first & middle combos.",
      "Grouped by meaning: nature, light, faith, love, strength and more.",
      "Tips for finding “the one,” in a design that's made to print.",
    ],
    formHeading: "Get your copy",
    payButton: "Continue to checkout",
    trust: ["Secure checkout by PayMongo", "Instant download after payment", "Link and password sent to your inbox"],
    personalUse: "For personal use only. Every PDF has its own password and your name on each page. Please don't share or resell it.",
    faqHeading: "FAQ",
    faq: [
      { q: "When do I get the PDF?", a: "Right after your payment clears, the download button and your PDF password show up on screen. We email them to you, too." },
      { q: "How do I open it?", a: "Open the file and enter your password. It works on phones, tablets and computers. You can download it up to 5 times in 7 days." },
      { q: "I paid but don't see my download.", a: "Give it a minute; some payments take a little longer. Still nothing? Message us with the email you used and we'll sort it out." },
    ],
    supportLine: "Questions? Message us on Facebook.",
    comingSoon: { title: "Coming soon", text: "The Name Nest Collection is almost here. Follow @namenest on Facebook so you don't miss it." },
    thanks: {
      waitingTitle: "Confirming your payment…",
      waitingText: "This usually takes just a few seconds. Please keep this page open.",
      slowText: "Still confirming. Some payments take a few minutes. Keep this page open; we'll also email you as soon as it's done.",
      paidTitle: "Thank you! Your PDF is ready",
      paidText: "Tap the button to download your PDF, then open it with the password below.",
      passwordLabel: "Your PDF password",
      emailedText: "We also sent your link and password to {email}.",
      downloadButton: "Download PDF",
      linkNote: "Your link works for 7 days, up to 5 downloads.",
      expiredTitle: "This link has expired",
      expiredText: "This order wasn't paid, or its link is no longer active. If you paid, message us with the email you used and we'll help.",
      notFoundTitle: "We can't find this order",
      notFoundText: "Please check the link in your email. If you paid, message us with the email you used and we'll help.",
    },
    email: {
      subject: "Your Name Nest PDF is ready",
      greeting: "Hi {name},",
      intro: "Thanks so much for your order! Your {product} is ready to download.",
      passwordLabel: "Your PDF password",
      button: "Download your PDF",
      note: "Your link works for 7 days, up to 5 downloads. The PDF is for your personal use only; please don't share or resell it.",
      signoff: "Happy name hunting, the Name Nest team",
    },
  },
};
