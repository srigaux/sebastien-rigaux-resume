import {
  acceptedService,
  eraseCookies,
  run,
  validConsent,
  type CookieItem,
  type Translation,
} from "vanilla-cookieconsent";

let analyticsStarted = false;

type ConsentState = "granted" | "denied";
const advertisingConsent = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
} as const;

/** Forward commands, so gtag creates its Arguments objects inside the worker. */
function gtag(...args: unknown[]) {
  const analyticsWindow = window as Window & { gtag?: (...args: unknown[]) => void };
  analyticsWindow.gtag?.(...args);
}

/** Set denied defaults before queuing any measurement or loading Google's tag. */
function startAnalytics() {
  const measurementId = document.querySelector<HTMLMetaElement>(
    'meta[name="google-analytics-id"]',
  )?.content;
  // The ID is only rendered in production. Print/PDF rendering never tracks.
  if (!measurementId || analyticsStarted || window.matchMedia("print").matches) return;
  analyticsStarted = true;

  const init = document.createElement("script");
  init.type = "text/partytown";
  init.id = "ga-init";
  // Bootstrap in the worker: a Date cannot be forwarded through Partytown intact.
  // Later consent updates are forwarded through the gtag stub in the main thread.
  init.textContent = `
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500
    });
    gtag('set', 'ads_data_redaction', true);
    gtag('set', 'url_passthrough', false);
    gtag('js', new Date());
    gtag('config', ${JSON.stringify(measurementId)}, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: ${JSON.stringify(window.location.origin + window.location.pathname)},
      page_referrer: ${JSON.stringify(safeReferrer())}
    });
  `;
  const loader = document.createElement("script");
  loader.type = "text/partytown";
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(init, loader);
  window.dispatchEvent(new CustomEvent("ptupdate"));
}

function safeReferrer() {
  if (!document.referrer) return "";
  try {
    const url = new URL(document.referrer);
    return url.origin + url.pathname;
  } catch {
    return "";
  }
}

function updateAnalyticsConsent() {
  if (!analyticsStarted) return;
  const analyticsStorage: ConsentState = acceptedService("ga", "analytics")
    ? "granted"
    : "denied";
  gtag("consent", "update", {
    analytics_storage: analyticsStorage,
    ...advertisingConsent,
  });
  if (analyticsStorage === "denied") {
    // Also covers rejection of just the GA service and expired consent cookies.
    for (const cookie of analyticsCookies()) {
      eraseCookies(cookie.name, cookie.path, cookie.domain);
    }
  }
}

/** GA can set cookies on a parent domain, unlike the host-only choice cookie. */
function analyticsCookies(): CookieItem[] {
  const domains = [location.hostname];
  const labels = location.hostname.split(".");
  // Browsers ignore attempts to clear a public-suffix cookie.
  for (let i = 1; i < labels.length - 1; i++) domains.push(labels.slice(i).join("."));
  return [
    { name: /^_ga(?:_|$)/, path: "/" },
    ...domains.map((domain) => ({ name: /^_ga(?:_|$)/, path: "/", domain })),
  ];
}

function translation(fr: boolean): Translation {
  return {
    consentModal: {
      title: fr ? "Votre choix, vos cookies" : "Your cookies, your choice",
      description: fr
        ? "Un peu d’analytics pour comprendre ce qui vous intéresse ici. Cookieless par défaut, plus précis avec les cookies. Votre choix reste modifiable à tout moment."
        : "A little analytics to understand what interests you here. Cookieless by default, more accurate with cookies. You can change your choice at any time.",
      acceptAllBtn: fr ? "Accepter" : "Accept",
      acceptNecessaryBtn: fr ? "Refuser" : "Reject",
      showPreferencesBtn: fr ? "Personnaliser" : "Customize",
    },
    preferencesModal: {
      title: fr ? "Préférences de cookies" : "Cookie preferences",
      acceptAllBtn: fr ? "Tout accepter" : "Accept all",
      acceptNecessaryBtn: fr ? "Tout refuser" : "Reject all",
      savePreferencesBtn: fr ? "Enregistrer mes choix" : "Save my choices",
      closeIconLabel: fr ? "Fermer" : "Close",
      serviceCounterLabel: fr ? "Service|Services" : "Service|Services",
      sections: [
        {
          title: fr ? "Vous gardez le contrôle" : "You are in control",
          description: fr
            ? "Votre choix contrôle les cookies de statistiques. Sans accord, Google Analytics reste chargé et reçoit des mesures sans cookies. Après un refus ou un retrait, ces mesures continuent ; aucun cookie Analytics n’est lu ou écrit."
            : "Your choice controls statistics cookies. Without consent, Google Analytics remains loaded and receives cookieless measurements. These continue after you decline or withdraw consent; no Analytics cookies are read or written.",
        },
        {
          title: fr ? "Nécessaires" : "Necessary",
          description: fr
            ? "Le cookie cc_cookie mémorise uniquement vos préférences de consentement pendant 182 jours sur ce site. Il ne peut pas être désactivé ici."
            : "The cc_cookie cookie only remembers your consent preferences on this site for 182 days. It cannot be disabled here.",
          linkedCategory: "necessary",
        },
        {
          title: fr ? "Statistiques" : "Statistics",
          description: fr
            ? "Google Analytics (Google) mesure les visites et les pages consultées. Les mesures sans cookies peuvent inclure la page visitée, le référent, le navigateur et la résolution de l’écran. Google reçoit aussi l’adresse IP lors de la connexion et indique ne pas la conserver dans Analytics. Après acceptation, les cookies _ga et _ga_* peuvent être déposés. Un refus ou un retrait supprime ces cookies et rétablit les mesures sans cookies. Les fonctions publicitaires restent désactivées. <a href='https://policies.google.com/technologies/partner-sites' target='_blank' rel='noopener noreferrer'>Utilisation des données par Google</a>."
            : "Google Analytics (Google) measures visits and page views. Cookieless measurements may include the visited page, referrer, browser and screen resolution. Google also receives the IP address during the connection and states that it does not store it in Analytics. After acceptance, _ga and _ga_* cookies may be stored. Declining or withdrawing consent deletes these cookies and restores cookieless measurement. Advertising features remain disabled. <a href='https://policies.google.com/technologies/partner-sites' target='_blank' rel='noopener noreferrer'>How Google uses data</a>.",
          linkedCategory: "analytics",
        },
      ],
    },
  };
}

export async function initCookieConsent() {
  // Neither the banner nor analytics belongs in the generated CV PDFs.
  if (window.matchMedia("print").matches) return;
  startAnalytics();
  await run({
    mode: "opt-in",
    revision: 2,
    manageScriptTags: false,
    cookie: { name: "cc_cookie", domain: "", path: "/", expiresAfterDays: 182, sameSite: "Lax" },
    guiOptions: {
      consentModal: { layout: "box inline", position: "bottom right", equalWeightButtons: true, flipButtons: false },
      preferencesModal: { layout: "box", equalWeightButtons: true, flipButtons: false },
    },
    categories: {
      necessary: { enabled: true, readOnly: true },
      analytics: {
        enabled: false,
        autoClear: { cookies: analyticsCookies() },
        services: { ga: { label: "Google Analytics" } },
      },
    },
    onConsent: updateAnalyticsConsent,
    onChange: updateAnalyticsConsent,
    language: {
      default: document.documentElement.lang === "en" ? "en" : "fr",
      translations: { fr: translation(true), en: translation(false) },
    },
  });
  // No callback runs until a first choice; clear cookies from expired revisions too.
  if (!validConsent()) updateAnalyticsConsent();
}
