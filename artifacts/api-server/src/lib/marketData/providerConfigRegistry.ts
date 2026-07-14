/**
 * Defines the vault keys, labels, and metadata for every registered market-data
 * provider. Used by the data-providers route to serve the generic config
 * GET/PUT endpoints, and by the admin UI to render per-provider config panels.
 *
 * Adding a new provider: add an entry here + a row in settingsDefinitions.ts.
 * The route and UI pick it up automatically.
 */

export interface ProviderConfigField {
  key: string;
  label: string;
  description: string;
  optional: boolean;
  sensitive: boolean;           // true → render as password input with show/hide
  defaultValue?: string;        // shown as placeholder when not yet configured
  placeholder?: string;         // overrides the generated placeholder text
}

export interface ProviderConfigDef {
  slug: string;
  displayName: string;
  docsUrl?: string;
  fields: ProviderConfigField[];
}

export const PROVIDER_CONFIG_REGISTRY: ProviderConfigDef[] = [
  {
    slug: "oanda",
    displayName: "OANDA",
    docsUrl: "https://developer.oanda.com/rest-live-v20/introduction/",
    fields: [
      {
        key: "market_data.oanda_api_key",
        label: "API Key",
        description: "Personal access token from OANDA. Log in → My Account → API Access → Generate.",
        optional: false,
        sensitive: true,
        placeholder: "Enter your OANDA personal access token",
      },
      {
        key: "market_data.oanda_account_id",
        label: "Account ID",
        description: "Your OANDA account ID — format 101-004-XXXXXXX-001. Found in Account Summary or the URL after login.",
        optional: false,
        sensitive: false,
        placeholder: "e.g. 101-004-1234567-001",
      },
      {
        key: "market_data.oanda_stream_url",
        label: "Stream URL",
        description: "OANDA streaming base URL. Leave blank to use the demo default.",
        optional: true,
        sensitive: false,
        defaultValue: "https://stream-fxpractice.oanda.com",
      },
      {
        key: "market_data.oanda_stream_symbols",
        label: "Stream Symbols",
        description: "Comma-separated instruments to subscribe to. Leave blank for the default set.",
        optional: true,
        sensitive: false,
        defaultValue: "EUR_USD,XAU_USD,GBP_USD",
        placeholder: "e.g. EUR_USD,GBP_USD,XAU_USD",
      },
    ],
  },
  {
    slug: "tiingo",
    displayName: "Tiingo",
    docsUrl: "https://api.tiingo.com/",
    fields: [
      {
        key: "market_data.tiingo_api_key",
        label: "API Key",
        description: "Tiingo API token. Log in at tiingo.com → Account → API Token.",
        optional: false,
        sensitive: true,
        placeholder: "Enter your Tiingo API token",
      },
    ],
  },
  {
    slug: "polygon",
    displayName: "Polygon.io",
    docsUrl: "https://polygon.io/dashboard/api-keys",
    fields: [
      {
        key: "market_data.polygon_api_key",
        label: "API Key",
        description: "Polygon.io API key. Log in at polygon.io → Dashboard → API Keys.",
        optional: false,
        sensitive: true,
        placeholder: "Enter your Polygon.io API key",
      },
    ],
  },
  {
    slug: "twelvedata",
    displayName: "Twelve Data",
    docsUrl: "https://twelvedata.com/account/api-keys",
    fields: [
      {
        key: "market_data.twelvedata_api_key",
        label: "API Key",
        description: "Twelve Data API key. Log in at twelvedata.com → My API Keys.",
        optional: false,
        sensitive: true,
        placeholder: "Enter your Twelve Data API key",
      },
    ],
  },
  {
    slug: "finnhub",
    displayName: "Finnhub",
    docsUrl: "https://finnhub.io/dashboard",
    fields: [
      {
        key: "market_data.finnhub_api_key",
        label: "API Key",
        description: "Finnhub API key. Log in at finnhub.io → Dashboard → API Key.",
        optional: false,
        sensitive: true,
        placeholder: "Enter your Finnhub API key",
      },
    ],
  },
  {
    slug: "alphavantage",
    displayName: "Alpha Vantage",
    docsUrl: "https://www.alphavantage.co/support/#api-key",
    fields: [
      {
        key: "market_data.alphavantage_api_key",
        label: "API Key",
        description: "Alpha Vantage API key. Get one free at alphavantage.co → Get Free API Key.",
        optional: false,
        sensitive: true,
        placeholder: "Enter your Alpha Vantage API key",
      },
    ],
  },
  {
    slug: "dxfeed",
    displayName: "DXfeed",
    docsUrl: "https://kb.dxfeed.com/en/data-access/",
    fields: [
      {
        key: "market_data.dxfeed_username",
        label: "Username",
        description: "DXfeed account username or login name. Provided in your DXfeed contract / welcome email.",
        optional: false,
        sensitive: false,
        placeholder: "Enter your DXfeed username",
      },
      {
        key: "market_data.dxfeed_password",
        label: "Password / Token",
        description: "DXfeed account password or authentication token.",
        optional: false,
        sensitive: true,
        placeholder: "Enter your DXfeed password or token",
      },
      {
        key: "market_data.dxfeed_endpoint",
        label: "Endpoint URL",
        description: "DXfeed WebSocket or REST endpoint URL. Provided in your DXfeed contract (e.g. demo.dxfeed.com:7300).",
        optional: false,
        sensitive: false,
        placeholder: "e.g. demo.dxfeed.com:7300",
      },
    ],
  },
  {
    slug: "interactive_brokers",
    displayName: "Interactive Brokers",
    docsUrl: "https://interactivebrokers.github.io/tws-api/",
    fields: [
      {
        key: "market_data.interactive_brokers_host",
        label: "TWS / Gateway Host",
        description: "Hostname or IP where Trader Workstation or IB Gateway is running. Usually 127.0.0.1 when running on the same machine.",
        optional: true,
        sensitive: false,
        defaultValue: "127.0.0.1",
        placeholder: "127.0.0.1",
      },
      {
        key: "market_data.interactive_brokers_port",
        label: "Port",
        description: "TWS paper: 7497 | TWS live: 7496 | IB Gateway paper: 4002 | IB Gateway live: 4001.",
        optional: true,
        sensitive: false,
        defaultValue: "7497",
        placeholder: "7497",
      },
      {
        key: "market_data.interactive_brokers_client_id",
        label: "Client ID",
        description: "IB API client ID (integer). Each concurrent connection to TWS/Gateway must use a unique client ID.",
        optional: true,
        sensitive: false,
        defaultValue: "1",
        placeholder: "1",
      },
    ],
  },
];

/** Look up config fields for a slug. Returns null if the slug is unrecognised. */
export function getProviderConfigDef(slug: string): ProviderConfigDef | null {
  return PROVIDER_CONFIG_REGISTRY.find((p) => p.slug === slug) ?? null;
}

/** All vault keys across all providers — used for allowlist enforcement. */
export const ALL_PROVIDER_CONFIG_KEYS = new Set<string>(
  PROVIDER_CONFIG_REGISTRY.flatMap((p) => p.fields.map((f) => f.key)),
);
