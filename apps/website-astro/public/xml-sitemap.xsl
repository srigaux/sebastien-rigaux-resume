<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  exclude-result-prefixes="sitemap xhtml">
  <xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>
  <xsl:template match="/">
    <xsl:variable name="index" select="boolean(sitemap:sitemapindex)"/>
    <xsl:variable name="entries" select="sitemap:sitemapindex/sitemap:sitemap | sitemap:urlset/sitemap:url"/>
    <xsl:variable name="languages" select="boolean($entries/xhtml:link[@hreflang])"/>
    <xsl:variable name="dates" select="boolean($entries/sitemap:lastmod[normalize-space(.) != ''])"/>
    <html lang="fr">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Plan du site XML | Sébastien Rigaux</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
        <style>
          :root { color-scheme: light; --paper: #f6f8f7; --ink: #1d2b2a; --accent: #0e625a; --muted: #536361; --rule: #c7d3d1; --selection: #c5e1db; }
          @media (prefers-color-scheme: dark) {
            :root { color-scheme: dark; --paper: #111c1a; --ink: #e8f1ee; --accent: #83d5c5; --muted: #b0c1bc; --rule: #38504a; --selection: #315d55; }
          }
          * { box-sizing: border-box; }
          body { margin: 0; background: var(--paper); color: var(--ink); font: 1rem/1.6 "IBM Plex Sans", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
          ::selection { background: var(--selection); color: var(--ink); }
          a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: .25em; }
          a:hover { text-decoration: underline; }
          a:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
          .shell { width: min(100%, 80rem); margin-inline: auto; padding-inline: clamp(1.25rem, 4vw, 3rem); }
          header { border-bottom: 1px solid var(--rule); }
          header .shell { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-block: 1rem; }
          .brand { color: var(--ink); font-family: "Sora", system-ui, sans-serif; font-size: clamp(1rem, 3vw, 1.5rem); font-weight: 700; letter-spacing: -.03em; text-decoration: none; }
          .brand span { color: var(--accent); }
          .home { font-size: .875rem; }
          main { padding-block: clamp(2.5rem, 7vw, 5rem); }
          h1 { margin: 0 0 1rem; font-family: "Sora", system-ui, sans-serif; font-size: clamp(2.25rem, 6vw, 4rem); line-height: 1.1; letter-spacing: -.03em; font-weight: 700; text-wrap: balance; }
          .intro { max-width: 65ch; margin: 0; color: var(--muted); }
          .count { margin: 2rem 0 1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          caption { text-align: left; color: var(--muted); margin-bottom: .75rem; font-size: .875rem; }
          th, td { text-align: left; vertical-align: top; padding: .625rem .75rem; border-bottom: 1px solid var(--rule); }
          th { color: var(--muted); font-size: .875rem; font-weight: 500; border-top: 1px solid var(--rule); }
          th:first-child, td:first-child { padding-left: 0; }
          th:last-child, td:last-child { padding-right: 0; }
          td a { overflow-wrap: anywhere; }
          .url { text-decoration: none; }
          .languages { width: 10rem; white-space: nowrap; }
          .languages a { display: inline-block; padding: 0 .25rem; margin-right: .125rem; font-size: .875rem; font-weight: 600; }
          .date { width: 11rem; color: var(--muted); font-size: .875rem; font-variant-numeric: tabular-nums; }
          footer { border-top: 1px solid var(--rule); padding-block: 1.5rem; color: var(--muted); font-size: .875rem; }
          footer p { margin: 0; max-width: 65ch; }
          @media (max-width: 600px) {
            header .shell { align-items: flex-start; flex-direction: column; gap: .25rem; }
            table, caption, tbody, tr, td { display: block; width: 100%; }
            thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
            tr { padding-block: .75rem; border-bottom: 1px solid var(--rule); }
            tbody tr:first-child { border-top: 1px solid var(--rule); }
            td { padding: 0; border: 0; }
            .languages, .date { width: 100%; margin-top: .375rem; }
            td[data-label]::before { content: attr(data-label) " : "; color: var(--muted); font-size: .875rem; }
          }
        </style>
      </head>
      <body>
        <header><div class="shell">
          <a class="brand" href="/">Sébastien <span>Rigaux</span></a>
          <a class="home" href="/">Retour au site</a>
        </div></header>
        <main class="shell">
          <h1>Plan du site <span style="color: var(--accent)">XML</span></h1>
          <p class="intro">Les pages publiques du CV et de la veille technologique, réunies dans un fichier destiné aux moteurs de recherche.</p>
          <p class="count">
            <xsl:value-of select="count($entries)"/>
            <xsl:choose><xsl:when test="$index"> fichier(s) sitemap</xsl:when><xsl:otherwise> URL(s)</xsl:otherwise></xsl:choose>
          </p>
          <table>
            <caption><xsl:choose><xsl:when test="$index">Ouvrez un sitemap pour consulter ses pages.</xsl:when><xsl:otherwise>Les liens de langue pointent vers les versions disponibles de chaque page.</xsl:otherwise></xsl:choose></caption>
            <thead><tr>
              <th scope="col"><xsl:choose><xsl:when test="$index">Sitemap</xsl:when><xsl:otherwise>URL</xsl:otherwise></xsl:choose></th>
              <xsl:if test="$languages"><th scope="col" class="languages">Langues</th></xsl:if>
              <xsl:if test="$dates"><th scope="col" class="date">Dernière modification</th></xsl:if>
            </tr></thead>
            <tbody>
              <xsl:for-each select="$entries">
                <tr>
                  <td><a class="url" href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
                  <xsl:if test="$languages"><td class="languages" data-label="Langues">
                    <xsl:choose>
                      <xsl:when test="xhtml:link[@hreflang]"><xsl:for-each select="xhtml:link[@hreflang]"><a href="{@href}" hreflang="{@hreflang}"><xsl:if test="@hreflang != 'x-default'"><xsl:attribute name="lang"><xsl:value-of select="@hreflang"/></xsl:attribute></xsl:if><xsl:value-of select="@hreflang"/></a></xsl:for-each></xsl:when>
                      <xsl:otherwise>—</xsl:otherwise>
                    </xsl:choose>
                  </td></xsl:if>
                  <xsl:if test="$dates"><td class="date" data-label="Dernière modification">
                    <xsl:choose>
                      <xsl:when test="normalize-space(sitemap:lastmod) != ''"><time datetime="{sitemap:lastmod}"><xsl:value-of select="substring(sitemap:lastmod, 9, 2)"/>/<xsl:value-of select="substring(sitemap:lastmod, 6, 2)"/>/<xsl:value-of select="substring(sitemap:lastmod, 1, 4)"/></time></xsl:when>
                      <xsl:otherwise>—</xsl:otherwise>
                    </xsl:choose>
                  </td></xsl:if>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
          <xsl:if test="not($entries)"><p>Aucune entrée dans ce sitemap.</p></xsl:if>
        </main>
        <footer><div class="shell"><p>CV et veille · Français / English. À propos du <a href="https://www.sitemaps.org/protocol.html">format sitemap XML</a>.</p></div></footer>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
