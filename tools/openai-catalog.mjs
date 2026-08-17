const SUPPORTED_CATEGORIES = new Set([
  "Productivity",
  "Creativity",
  "Developer Tools",
  "Business & Operations",
  "Data & Analytics",
  "Communication",
  "Education & Research",
  "Security",
  "Finance",
  "Healthcare",
  "Travel",
  "Entertainment",
  "Other"
]);

// Final directory submission is intentionally stricter than package upload.
// https://developers.openai.com/plugins/deploy/submission-errors#final-directory-submission
const FINAL_LIMITS = {
  displayName: 30,
  shortDescription: 30,
  longDescription: 4_000,
  developerName: 80,
  capabilities: 20,
  capability: 120,
  starterPrompts: 3,
  starterPrompt: 128,
  url: 1_024
};

function assertSupportedText(value, field, singleLine = false) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (singleLine && /[\r\n]/.test(value)) {
    throw new Error(`${field} must fit on one line`);
  }
  const unsupportedControl = singleLine
    ? /\p{Cc}/u
    : /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/;
  if (unsupportedControl.test(value) || /\u2028|\u2029|[\u200B-\u200D\u2060\uFEFF]/u.test(value)) {
    throw new Error(`${field} contains unsupported control or invisible characters`);
  }
}

function assertLimitedText(value, field, limit, singleLine = false) {
  assertSupportedText(value, field, singleLine);
  if ([...value].length > limit) {
    throw new Error(`${field} exceeds the final-directory limit of ${limit} characters`);
  }
}

export function normalizeStarterPrompt(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

export function assertCatalogUrl(value, field) {
  assertLimitedText(value, field, FINAL_LIMITS.url, true);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${field} must be HTTPS with a host and no embedded credentials`);
  }
}

export function validateOpenAiCatalogMetadata(metadata) {
  const catalog = metadata.interface;
  assertLimitedText(catalog.displayName, "interface.displayName", FINAL_LIMITS.displayName, true);
  assertLimitedText(catalog.shortDescription, "interface.shortDescription", FINAL_LIMITS.shortDescription, true);
  assertLimitedText(catalog.longDescription, "interface.longDescription", FINAL_LIMITS.longDescription);
  assertLimitedText(catalog.developerName, "interface.developerName", FINAL_LIMITS.developerName, true);
  if (!SUPPORTED_CATEGORIES.has(catalog.category)) {
    throw new Error(`interface.category is unsupported: ${catalog.category}`);
  }
  if (!Array.isArray(catalog.capabilities) || catalog.capabilities.length > FINAL_LIMITS.capabilities) {
    throw new Error(`interface.capabilities must contain at most ${FINAL_LIMITS.capabilities} entries`);
  }
  catalog.capabilities.forEach((value, index) => {
    assertLimitedText(value, `interface.capabilities[${index}]`, FINAL_LIMITS.capability, true);
  });

  const prompts = catalog.defaultPrompt;
  if (!Array.isArray(prompts) || prompts.length === 0 || prompts.length > FINAL_LIMITS.starterPrompts) {
    throw new Error(`interface.defaultPrompt must contain one to ${FINAL_LIMITS.starterPrompts} starter prompts`);
  }
  const normalizedPrompts = new Set();
  prompts.forEach((value, index) => {
    assertLimitedText(value, `interface.defaultPrompt[${index}]`, FINAL_LIMITS.starterPrompt, true);
    if (/@[\p{L}\p{N}_-]+/u.test(value)) {
      throw new Error(`interface.defaultPrompt[${index}] must not contain an @mention`);
    }
    const normalized = normalizeStarterPrompt(value);
    if (normalizedPrompts.has(normalized)) {
      throw new Error("interface.defaultPrompt entries must be unique after Unicode and whitespace normalization");
    }
    normalizedPrompts.add(normalized);
  });

  for (const field of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL", "supportURL"]) {
    assertCatalogUrl(catalog[field], `interface.${field}`);
  }

  assertSupportedText(metadata.author?.name, "author.name", true);
  if (metadata.author.name !== catalog.developerName) {
    throw new Error("author.name and interface.developerName must match the verified publisher identity");
  }

  const skill = metadata.skillInterface;
  const expectedSkillKeys = ["displayName", "shortDescription", "defaultPrompt", "allowImplicitInvocation"];
  if (!skill || JSON.stringify(Object.keys(skill)) !== JSON.stringify(expectedSkillKeys)) {
    throw new Error(`skillInterface must contain exactly: ${expectedSkillKeys.join(", ")}`);
  }
  assertLimitedText(skill.displayName, "skillInterface.displayName", FINAL_LIMITS.displayName, true);
  assertLimitedText(skill.shortDescription, "skillInterface.shortDescription", FINAL_LIMITS.shortDescription, true);
  assertLimitedText(skill.defaultPrompt, "skillInterface.defaultPrompt", FINAL_LIMITS.starterPrompt, true);
  if (typeof skill.allowImplicitInvocation !== "boolean") {
    throw new Error("skillInterface.allowImplicitInvocation must be boolean");
  }
}

export function openAiSkillAgentYaml(metadata) {
  validateOpenAiCatalogMetadata(metadata);
  return [
    "interface:",
    `  display_name: ${JSON.stringify(metadata.skillInterface.displayName)}`,
    `  short_description: ${JSON.stringify(metadata.skillInterface.shortDescription)}`,
    `  default_prompt: ${JSON.stringify(metadata.skillInterface.defaultPrompt)}`,
    "policy:",
    `  allow_implicit_invocation: ${metadata.skillInterface.allowImplicitInvocation}`,
    ""
  ].join("\n");
}

export { FINAL_LIMITS };
