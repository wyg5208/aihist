/**
 * The AI Lab sister sites. Both ai-edu.pw and ai-skill.pw link back to AI 纪年
 * from their own header and footer, so the public footer returns the favour.
 * Labels and taglines are copied from the two sites' own titles — keep them in
 * step if either site renames itself.
 */
export type SisterSite = {
  id: string;
  name: string;
  tagline: string;
  href: string;
  domain: string;
};

export const SISTER_SITES: readonly SisterSite[] = [
  {
    id: "ai-edu",
    name: "AI 素养学习站",
    tagline: "独立 AI 素养培训学习平台",
    href: "https://ai-edu.pw",
    domain: "ai-edu.pw",
  },
  {
    id: "ai-skill",
    name: "AI 素养考核站",
    tagline: "独立 AI 素养考核认证平台",
    href: "https://ai-skill.pw",
    domain: "ai-skill.pw",
  },
];
