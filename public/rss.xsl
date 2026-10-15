<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>
  <xsl:template match="/rss">
    <xsl:variable name="fr" select="starts-with(channel/language, 'fr')"/>
    <xsl:variable name="home"><xsl:choose><xsl:when test="$fr">/veille</xsl:when><xsl:otherwise>/en/tech-watch</xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="feed" select="channel/atom:link[@rel='self']/@href" xmlns:atom="http://www.w3.org/2005/Atom"/>
    <html lang="{channel/language}">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="channel/title"/> · RSS</title>
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
          footer { border-top: 1px solid var(--rule); padding-block: 1.5rem; color: var(--muted); font-size: .875rem; }
          footer p { margin: 0; max-width: 65ch; }
          .subscribe { margin-block: 2rem; padding-block: 1.25rem; border-block: 1px solid var(--rule); }
          .subscribe p { max-width: 65ch; margin: 0 0 .75rem; color: var(--muted); }
          .feed-url { display: block; width: 100%; padding: .75rem; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); font: inherit; border-radius: 0; }
          .feed-url:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
          .entries { padding: 0; margin: 0; list-style: none; }
          .entries li { padding-block: 1.5rem; border-top: 1px solid var(--rule); }
          h2 { margin: .5rem 0; font-size: clamp(1.2rem, 3vw, 1.5rem); line-height: 1.35; }
          h2 a { text-decoration: none; }
          .summary { max-width: 72ch; margin: 0; color: var(--muted); overflow-wrap: anywhere; }
          .topics { margin: .75rem 0 0; font-size: .875rem; color: var(--muted); }
        </style>
      </head>
      <body>
        <header><div class="shell">
          <a class="brand" href="{$home}">Sébastien <span>Rigaux</span></a>
          <a class="home" href="{$home}"><xsl:choose><xsl:when test="$fr">Retour à la veille</xsl:when><xsl:otherwise>Back to tech watch</xsl:otherwise></xsl:choose></a>
        </div></header>
        <main class="shell">
          <h1><xsl:choose><xsl:when test="$fr">Veille technologique</xsl:when><xsl:otherwise>Tech watch</xsl:otherwise></xsl:choose><span style="color: var(--accent)"> RSS</span></h1>
          <p class="intro"><xsl:value-of select="channel/description"/></p>
          <section class="subscribe" aria-labelledby="subscribe-title">
            <h2 id="subscribe-title"><xsl:choose><xsl:when test="$fr">S’abonner au flux</xsl:when><xsl:otherwise>Subscribe to the feed</xsl:otherwise></xsl:choose></h2>
            <p><xsl:choose><xsl:when test="$fr">Copiez cette adresse dans votre lecteur RSS pour recevoir les nouvelles sélections.</xsl:when><xsl:otherwise>Copy this address into your RSS reader to receive new selections.</xsl:otherwise></xsl:choose></p>
            <label for="feed-url"><xsl:choose><xsl:when test="$fr">Adresse du flux RSS</xsl:when><xsl:otherwise>RSS feed address</xsl:otherwise></xsl:choose></label>
            <input id="feed-url" class="feed-url" type="url" readonly="readonly" value="{$feed}"/>
          </section>
          <p class="count"><xsl:value-of select="count(channel/item)"/><xsl:choose><xsl:when test="$fr"> dernières sélections</xsl:when><xsl:otherwise> latest selections</xsl:otherwise></xsl:choose></p>
          <ul class="entries">
            <xsl:for-each select="channel/item">
              <li>
                <span class="date"><xsl:value-of select="pubDate"/></span>
                <h2><a href="{link}"><xsl:value-of select="title"/></a></h2>
                <p class="summary"><xsl:value-of select="description"/></p>
                <xsl:if test="category"><p class="topics"><xsl:for-each select="category"><xsl:if test="position() > 1"> · </xsl:if><xsl:value-of select="."/></xsl:for-each></p></xsl:if>
              </li>
            </xsl:for-each>
          </ul>
          <xsl:if test="not(channel/item)"><p><xsl:choose><xsl:when test="$fr">Les premières sélections arrivent bientôt.</xsl:when><xsl:otherwise>The first selections are coming soon.</xsl:otherwise></xsl:choose></p></xsl:if>
        </main>
        <footer><div class="shell"><p>Sébastien Rigaux · <xsl:choose><xsl:when test="$fr">Veille technologique</xsl:when><xsl:otherwise>Tech watch</xsl:otherwise></xsl:choose> · RSS 2.0</p></div></footer>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
