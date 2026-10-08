export type Locale = "fr" | "en";

export type TimelineItem = {
  id: string;
  title: string;
  subtitle: string;
  period: string;
  description?: string;
  bullets?: readonly string[];
  distinction?: string;
};

export type Skill = {
  label: string;
  value: number;
  level?: string;
};

export type Person = {
  firstName: string;
  lastName: string;
  role: string;
  jobTitle: string;
  birthday: string;
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
