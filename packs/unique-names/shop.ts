import type { PackShop } from "../types";

// Unique Names (@unique_names): the public names PDF shop (/shop, docs/SHOP.md). Simple global English for moms around
// the world, most in the Philippines: short sentences, no slang, no Tagalog. Pay with QR Ph (GCash, Maya, bank apps).

export const UNIQUE_NAMES_SHOP: PackShop = {
  enabled: true,
  currency: "PHP",
  locale: "en-PH",
  products: {
    girl: { name: "Girl Names Edition", price: 5000, blurb: "Every baby girl name from our page, with meanings." },
    boy: { name: "Boy Names Edition", price: 5000, blurb: "Every baby boy name from our page, with meanings." },
    both: { name: "Girl & Boy Bundle", price: 10000, blurb: "Both editions in one PDF. Perfect if you don't know yet.", badge: "Both lists" },
  },
  productOrder: ["girl", "boy", "both"],
  paymentMethods: ["qrph"],
  // The page has no username, so Messenger takes its page id (facebook.com/profile.php?id=61572452954153).
  // env SHOP_MESSENGER_URL overrides it.
  messenger: "https://m.me/61572452954153",
  delivery: { email: true, messenger: false },
  previews: { cover: "/packs/unique-names/shop/cover.webp", page: "/packs/unique-names/shop/names-page.webp" },
  copy: {
    metaTitle: "The Unique Names Collection (PDF)",
    metaDescription: "Every unique baby name from our page, with simple meanings, in one lovely PDF. Instant download after payment.",
    eyebrow: "The Unique Names Collection",
    title: "Find the one, faster",
    subtitle: "All the beautiful, rare names from our page in one lovely PDF, with a short meaning under every name. Download it right after you pay.",
    insideHeading: "What's inside",
    inside: [
      "{girl} girl names and {boy} boy names, each with a short, simple meaning.",
      "Single names first, then combo names (a first name and a middle name).",
      "Grouped by meaning: nature, light, faith, love, strength and more.",
      "Tips to help you choose, and a pretty design you can print.",
    ],
    formHeading: "Get your copy",
    payButton: "Continue to payment",
    trust: [
      "Secure payment by PayMongo",
      "Pay with GCash, Maya or your bank app (QR Ph)",
      "Instant download after payment",
      "We also email you the link and password",
    ],
    personalUse: "For personal use only. Each PDF has its own password and your name on every page. Please don't share or resell it.",
    faqHeading: "Questions",
    faq: [
      {
        q: "How do I pay with GCash?",
        a: "Tap “Continue to payment”. PayMongo shows a QR Ph code. Save it (screenshot or long-press) or keep it on the screen. Open GCash, tap “Pay QR”, then “Upload QR” and pick the saved picture (or scan it from another phone). Check the amount and pay.",
      },
      { q: "Can I use Maya or my bank app?", a: "Yes. Any app that pays QR Ph works: Maya, BPI, BDO Pay, UnionBank, GoTyme, ShopeePay and more." },
      { q: "When do I get the PDF?", a: "Right after the payment goes through, the download button and your PDF password appear on the screen. We also email them to you." },
      { q: "How do I open the PDF?", a: "Open the file and type the password we gave you. It works on phones and computers. You can download it up to 5 times in 7 days." },
      { q: "I paid but nothing happened.", a: "Please wait a minute; some payments take a little longer. If you still don't see your download, message us with the email you used and we will help you." },
    ],
    supportLine: "Need help? Message us on Facebook.",
    comingSoon: { title: "Coming soon", text: "Our names PDF will be here very soon. Follow @unique_names on Facebook so you don't miss it." },
    thanks: {
      waitingTitle: "Confirming your payment…",
      waitingText: "This usually takes a few seconds. Please keep this page open.",
      slowText: "Still confirming. Some payments take a few minutes. You can keep this page open, and we will also email you as soon as it's done.",
      paidTitle: "Thank you! Your PDF is ready",
      paidText: "Tap the button to download your PDF. Open it with the password below.",
      passwordLabel: "Your PDF password",
      emailedText: "We also sent the link and the password to {email}.",
      downloadButton: "Download PDF",
      linkNote: "Your link works for 7 days, up to 5 downloads.",
      expiredTitle: "This link has ended",
      expiredText: "This order was not paid, or its link is no longer active. If you paid, message us with the email you used and we will help you.",
      notFoundTitle: "We can't find this order",
      notFoundText: "Please check the link in your email. If you paid, message us with the email you used and we will help you.",
    },
    email: {
      subject: "Your Unique Names PDF is ready",
      greeting: "Hi {name},",
      intro: "Thank you for your order! Your {product} is ready to download.",
      passwordLabel: "Your PDF password",
      button: "Download your PDF",
      note: "The link works for 7 days, up to 5 downloads. The PDF is for your personal use only; please don't share or resell it.",
      signoff: "With love, the Unique Names team",
    },
  },
};
