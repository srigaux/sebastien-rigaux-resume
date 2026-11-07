import { z } from 'zod'

export const tagCategories = [
  'language',
  'framework-library',
  'tool-application',
  'platform-infrastructure',
  'standard-api-format',
  'concept-technique',
  'practice-method',
  'domain-use-case',
] as const
const text = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^<>\r\n]+$/)
const localizedTag = z.object({
  name: text.max(80),
  uid: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  description: text,
  aliases: z.array(text.max(80)).max(5),
  seoTitle: text.max(110),
  seoDescription: text,
})
export const tagProposalSchema = z.object({
  category: z.enum(tagCategories),
  fr: localizedTag,
  en: localizedTag,
  relatedUids: z.array(z.string()).max(3),
})
export type TagProposal = z.infer<typeof tagProposalSchema>

/** Preserve punctuation: C#, C++ and C must never collapse to one identity. */
export function normalizeTagName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/g, ' ')
}

export function validateTagProposals(
  proposals: TagProposal[],
  existing: Array<{ uid: string; name: string; aliases?: string[] }>
) {
  const names = new Map<string, string>()

  for (const tag of existing) {
    for (const name of [tag.name, tag.uid, ...(tag.aliases ?? [])]) {
      names.set(normalizeTagName(name), tag.uid)
    }
  }

  for (const proposal of proposals) {
    tagProposalSchema.parse(proposal)
    const terms = new Set(
      [
        proposal.fr.uid,
        proposal.en.uid,
        proposal.fr.name,
        proposal.en.name,
        ...proposal.fr.aliases,
        ...proposal.en.aliases,
      ].map(normalizeTagName)
    )

    for (const term of terms) {
      const collision = names.get(term)

      if (collision) {
        throw new Error(`Tag déjà connu ou ambigu : ${term} (${collision}).`)
      }
    }

    for (const term of terms) {
      names.set(term, proposal.fr.uid)
    }

    if (
      new Set(proposal.relatedUids).size !== proposal.relatedUids.length ||
      proposal.relatedUids.some(
        (uid) => !existing.some((tag) => tag.uid === uid)
      )
    ) {
      throw new Error('Tags associés inconnus ou répétés.')
    }
  }
}

export function tagProposalKey(proposal: TagProposal): string {
  return JSON.stringify(proposal)
}

export function pendingTagProposals(
  draft: { newTags?: TagProposal[] },
  accepted: string[] = []
): boolean {
  return (draft.newTags ?? []).some(
    (proposal) => !accepted.includes(tagProposalKey(proposal))
  )
}
