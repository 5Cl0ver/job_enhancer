// Switches for Job Catcher's autofill.

// Spec 020: autofill uses NO AI for now. The owner wants it right without AI
// first; boxes Job Catcher doesn't know are left under "Needs you". The AI
// pass (session.fillWithAi, POST /v1/ai/autofill-map) stays in the code, off,
// for the later AI phase.
export const AI_IN_AUTOFILL = false;
