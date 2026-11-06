import { type ReactNode, useState } from 'react'

import {
  type WatchImage,
  type WatchSource,
  type WatchTopic,
  watchPath,
} from '@/lib/watch-model'
import type { Locale } from '@/types'

export type WatchSearchHit = {
  objectID: string
  locale?: Locale
  title: string
  summary: string
  summaryHtml: string
  path: string
  format: string
  topics?: string[]
  topicDetails?: WatchTopic[]
  selectedOn?: string
  url?: string
  image?: WatchImage | null
  siteIcon?: WatchImage | null
  source?: WatchSource | null
  credit?: string
  sourceLanguage?: string
  textLanguage?: string
}

function webUrl(value?: string): string | undefined {
  try {
    const url = new URL(value || '')
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function SiteIcon({
  hit,
  monogram,
}: {
  hit: WatchSearchHit
  monogram: string
}) {
  const [failed, setFailed] = useState<string[]>([])
  const src = [hit.siteIcon?.url, hit.source?.icon?.url]
    .map(webUrl)
    .find((url) => url && !failed.includes(url))
  return src ? (
    <img
      src={src}
      alt=""
      width={24}
      height={24}
      loading="lazy"
      decoding="async"
      onError={() => setFailed((previous) => [...previous, src])}
      className="pointer-events-none relative -top-0.5 mr-2 inline-block size-6 object-contain align-middle"
    />
  ) : (
    <span
      aria-hidden="true"
      className="pointer-events-none relative -top-0.5 mr-2 inline-flex size-6 items-center justify-center rounded-full bg-accent align-middle font-sans text-sm font-bold text-paper"
    >
      {monogram}
    </span>
  )
}

function FormatIcon({ format }: { format: string }) {
  const paths: Record<string, ReactNode> = {
    Article: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </>
    ),
    Video: (
      <>
        <rect x="3" y="5" width="13" height="14" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    Repository: (
      <>
        <circle cx="6" cy="3" r="2" />
        <circle cx="18" cy="3" r="2" />
        <circle cx="6" cy="21" r="2" />
        <path d="M6 5v14M18 5v3a4 4 0 0 1-4 4H6" />
      </>
    ),
    Release: (
      <>
        <path d="M4 16c-2 2-2 5-2 5s3 0 5-2M12 15l-3-3a18 18 0 0 1 3-6c3-3 9-3 9-3s0 6-3 9a18 18 0 0 1-6 3Z" />
        <circle cx="16" cy="8" r="1" />
        <path d="m9 12-4-1-3 3 5 1m5 0 1 5 3-3-1-4" />
      </>
    ),
    Documentation: (
      <>
        <path d="M12 7v14M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z" />
      </>
    ),
    Tool: (
      <path d="m14 6 4 4 4-4a7 7 0 0 1-9 9l-6 6a3 3 0 0 1-4-4l6-6a7 7 0 0 1 9-9Z" />
    ),
    Other: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
      aria-hidden="true"
    >
      {paths[format] || paths.Other}
    </svg>
  )
}

export default function WatchSearchCard({
  hit,
  locale,
  title,
}: {
  hit: WatchSearchHit
  locale: Locale
  title: ReactNode
}) {
  const original = webUrl(hit.url)
  const sourceUrl = webUrl(hit.source?.url)
  const domain = original
    ? new URL(original).hostname.replace(/^www\./, '')
    : ''
  const permalink =
    hit.path?.startsWith('/') && !hit.path.startsWith('//')
      ? hit.path
      : undefined
  const image = webUrl(hit.image?.url)
  const [failedImage, setFailedImage] = useState(false)
  const date =
    hit.selectedOn && !Number.isNaN(Date.parse(hit.selectedOn))
      ? new Intl.DateTimeFormat(locale === 'fr' ? 'fr-BE' : 'en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(hit.selectedOn))
      : ''
  const external =
    locale === 'fr' ? 'Ouvrir le lien original' : 'Open original link'
  const contentLanguage = hit.textLanguage || hit.locale
  const language = hit.sourceLanguage?.toUpperCase()
  const sourceLanguageTitle =
    locale === 'fr'
      ? `Langue de la source : ${language === 'EN' ? 'anglais' : 'français'}`
      : `Source language: ${language === 'FR' ? 'French' : 'English'}`
  return (
    <article className="relative isolate min-w-0 py-8 sm:py-10">
      <header className="mb-5">
        <div className="pointer-events-none relative z-10 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {date && (
            <time
              dateTime={hit.selectedOn}
              aria-label={`${locale === 'fr' ? 'Sélectionné le' : 'Selected on'} ${date}`}
            >
              {date}
            </time>
          )}
          {date && <span aria-hidden="true">·</span>}
          <span className="inline-flex items-center gap-1.5">
            <FormatIcon format={hit.format} />
            {hit.format}
          </span>
          {language && language.toLowerCase() !== locale && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="border border-rule px-1.5 py-0.5 font-semibold tracking-wide"
                title={sourceLanguageTitle}
                aria-label={sourceLanguageTitle}
              >
                {language}
              </span>
            </>
          )}
        </div>
        <h2
          lang={contentLanguage}
          className="pr-8 font-display text-xl leading-snug font-semibold tracking-tight sm:text-2xl"
        >
          <SiteIcon hit={hit} monogram={domain.charAt(0).toUpperCase()} />
          {original ? (
            <a
              href={original}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${hit.title} — ${external}`}
              className="text-ink after:absolute after:inset-0 after:z-0 after:content-[''] hover:text-accent"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </h2>
        <div className="pointer-events-none relative z-10 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
          <span className="break-all">{domain}</span>
          {permalink && (
            <a
              href={permalink}
              aria-label={`${locale === 'fr' ? 'Permalien' : 'Permalink'} : ${hit.title}`}
              className="pointer-events-auto underline decoration-rule underline-offset-4 hover:text-accent"
            >
              {locale === 'fr' ? 'Permalien' : 'Permalink'}
            </a>
          )}
        </div>
      </header>
      <div className="flow-root">
        {image && !failedImage && (
          <div className="pointer-events-none float-left mt-1.5 mr-4 mb-1 aspect-[1200/630] w-[10.375rem] overflow-hidden rounded-xl bg-ink/5 sm:mr-6 sm:w-[14.375rem]">
            <img
              src={image}
              alt={hit.image?.alt || ''}
              width={hit.image?.width}
              height={hit.image?.height}
              loading="lazy"
              decoding="async"
              onError={() => setFailedImage(true)}
              className="h-full w-full object-cover"
            />
          </div>
        )}
        <div
          lang={contentLanguage}
          className="pointer-events-none text-base leading-[1.75] break-words text-muted [&_a]:pointer-events-auto [&_a]:relative [&_a]:z-10 [&_a]:underline [&_a]:decoration-rule [&_a:hover]:text-accent [&_code]:rounded [&_code]:bg-ink/5 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_em]:italic [&_p+p]:mt-3 [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: hit.summaryHtml }}
        />
      </div>
      <div className="pointer-events-none relative z-10 mt-4 flex flex-wrap items-center gap-2">
        {hit.topicDetails?.length
          ? hit.topicDetails.map((topic) => (
              <a
                key={topic.uid}
                href={watchPath(locale, 1, topic.uid)}
                className="pointer-events-auto relative z-10 rounded-md bg-ink/5 px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-accent/10 hover:text-accent"
              >
                {topic.name}
              </a>
            ))
          : hit.topics?.map((topic) => (
              <span
                key={topic}
                className="rounded-md bg-ink/5 px-2.5 py-1.5 text-xs text-muted"
              >
                {topic}
              </span>
            ))}
      </div>
      {(hit.credit || hit.source) && (
        <p className="pointer-events-none relative z-10 mt-4 text-xs text-muted">
          {hit.credit && <span lang="en">{hit.credit}</span>}
          {hit.credit && hit.source && <span aria-hidden="true"> · </span>}
          {hit.source && (
            <span>
              {locale === 'fr' ? 'Repéré via' : 'Found via'}{' '}
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto relative z-10 underline decoration-rule hover:text-accent"
                >
                  {hit.source.name}
                </a>
              ) : (
                hit.source.name
              )}
            </span>
          )}
        </p>
      )}
    </article>
  )
}
