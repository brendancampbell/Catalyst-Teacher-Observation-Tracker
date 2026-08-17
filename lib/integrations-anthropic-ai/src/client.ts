import Anthropic from "@anthropic-ai/sdk";

/*
 * Lazy client, for the same reason lib/db is lazy: this module used to throw at
 * load time if the integration env vars were absent, so merely importing a
 * route that mentions AI — to unit-test an unrelated pure function inside it —
 * required the Anthropic integration to be provisioned.
 *
 * The checks still run, with identical messages, on first use. Anything that
 * actually calls Anthropic fails exactly as before; anything that only imports
 * the module no longer does.
 */

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

    if (!baseURL) {
      throw new Error(
        "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?",
      );
    }
    if (!apiKey) {
      throw new Error(
        "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?",
      );
    }

    client = new Anthropic({ apiKey, baseURL });
  }
  return client;
}

/** Forwards every access to the real client, constructing it on demand. */
export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const target = getClient();
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(_target, prop, value) {
    return Reflect.set(getClient(), prop, value);
  },
  has(_target, prop) {
    return Reflect.has(getClient(), prop);
  },
  getPrototypeOf(_target) {
    return Reflect.getPrototypeOf(getClient());
  },
});
