export interface MemoryProfile {
	id: string;
	version: number;
	description: string;
	schema: string;
	indexingGuidance: string[];
	presentation: {
		summaryGuidance: string;
		sectionOrder: string[];
	};
	steeringGuidance: string[];
}

const schema = `{
  "title": "short title",
  "summary": "brief orientation",
  "sections": [{
    "title": "section title",
    "items": [{
      "kind": "proposal|decision|assumption|reported|observed|open|next|context",
      "text": "standalone statement",
      "detail": "optional rationale or qualification"
    }]
  }]
}`;

export const softwareProfile: MemoryProfile = {
	id: "software-development",
	version: 2,
	description: "Working memory for software design, implementation, diagnosis, and review conversations.",
	schema,
	indexingGuidance: [
		"Capture the goal, constraints, current implementation understanding, changed or discussed files, observed results, and likely next work.",
		"Distinguish proposals, accepted decisions, assumptions, reported claims, observed results, unresolved questions, and next actions using item.kind.",
		"Keep contradictions visible and retain useful rationale and superseded choices.",
		"Never turn remembered validation into a claim about current repository, ticket, PR, or CI state.",
	],
	presentation: {
		summaryGuidance: "Use plain language. Start with one or two short sentences that orient someone returning to the work. Add only a few short Markdown bullets when they materially clarify the current state, important choices, or something needing the user's attention. Prefer concrete project language over generic lifecycle warnings, repeated caveats, or jargon.",
		sectionOrder: ["Goal and constraints", "Current understanding", "Decisions and rationale", "Progress and observations", "Unresolved", "Next attention"],
	},
	steeringGuidance: [
		"Produce the smallest self-contained prompt that enables the stated next intent.",
		"Preserve uncertainty and do not imply remembered results are fresh verification.",
	],
};

// Tiny non-software fixture proving the core consumes profile guidance rather than fixed domain fields.
export const genericProfileExample: MemoryProfile = {
	id: "general",
	version: 1,
	description: "Generic conversation memory.",
	schema,
	indexingGuidance: ["Capture durable context, decisions, open questions, and next attention."],
	presentation: { summaryGuidance: "Give a brief orientation.", sectionOrder: ["Context", "Open questions", "Next attention"] },
	steeringGuidance: ["Keep the prompt concise and preserve uncertainty."],
};
