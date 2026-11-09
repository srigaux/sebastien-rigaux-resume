// Conservative signatures observed in agent fetchers. Unknown preferences stay HTML.
// This is deliberately not a general HTTP Accept parser.
export const markdownAccepts = [
  'text/markdown',
  'text/markdown;q=1',
  'text/markdown;q=1.0',
  'text/markdown, text/html',
  'text/html, text/markdown',
  'text/markdown, text/html;q=0.9, */*;q=0.8',
  'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  'text/markdown, */*;q=0.1',
  'text/markdown;q=1.0, */*;q=0.1',
].flatMap((value) => [value, value.replaceAll(' ', '')])

export const siteHost = 'sebastien.rigaux.be'
const host = `http.host eq "${siteHost}"`
const accept = `len(http.request.headers["accept"]) eq 1 and lower(trim(http.request.headers["accept"][0])) in {${[...new Set(markdownAccepts)].map((value) => JSON.stringify(value)).join(' ')}}`
const methods = 'http.request.method in {"GET" "HEAD"}'

export function rewriteRuleset() {
  return {
    name: 'Sebastien Markdown negotiation',
    kind: 'zone',
    phase: 'http_request_transform',
    rules: [
      {
        ref: 'sebastien_markdown_home',
        description: 'Serve index.md to Markdown-capable agents on the CV root',
        expression: `(${host} and ${methods} and http.request.uri.path eq "/" and ${accept})`,
        action: 'rewrite',
        action_parameters: { uri: { path: { value: '/index.md' } } },
        enabled: true,
      },
      {
        ref: 'sebastien_markdown_pages',
        description:
          'Serve sibling Markdown exports without changing the public URL',
        expression: `(${host} and ${methods} and http.request.uri.path ne "/" and not http.request.uri.path contains "." and not http.request.uri.path in {"/fr" "/fr/" "/404" "/404/"} and ${accept})`,
        action: 'rewrite',
        action_parameters: {
          uri: {
            path: {
              expression: 'concat(trim_end(http.request.uri.path, "/"), ".md")',
            },
          },
        },
        enabled: true,
      },
    ],
  }
}

export function redirectRuleset() {
  return {
    name: 'Sebastien legacy URLs',
    kind: 'zone',
    phase: 'http_request_dynamic_redirect',
    rules: [
      [
        'sebastien_legacy_fr',
        '{"/fr" "/fr/" "/fr.html" "/fr/index.html"}',
        '/',
      ],
      ['sebastien_legacy_markdown', '{"/fr.md"}', '/index.md'],
    ].map(([ref, paths, target]) => ({
      ref,
      description: ref,
      expression: `(${host} and http.request.uri.path in ${paths})`,
      action: 'redirect',
      action_parameters: {
        from_value: {
          status_code: 301,
          target_url: { value: `https://${siteHost}${target}` },
          preserve_query_string: true,
        },
      },
      enabled: true,
    })),
  }
}
