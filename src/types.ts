export type Locale = "fr" | "en";

export type TimelineText = string | readonly (string | { text: string; href: string })[];

export type TimelineItem = {
  id: string;
  title: TimelineText;
  subtitle: TimelineText;
  period: string;
  description?: string;
  bullets?: readonly string[];
  distinction?: string;
};

export type Person = {
  firstName: string;
  lastName: string;
  role: Record<Locale, string>;
  jobTitle: Record<Locale, string>;
  firstExperienceDate: string;
  email: string;
  phone: string;
  address: {
    formatted: string;
    zip: string;
    locality: string;
    country: string;
  };
  socialLinks: readonly { label: string; identifier: string; url: string }[];
};
