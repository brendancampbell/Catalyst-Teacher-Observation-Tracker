type AnalyticsValue = string | number | boolean;

export type AnalyticsEventProperties = {
  observation_submitted: {
    surface: "mobile";
    observation_kind: "observation" | "walkthrough";
    outcome: "created" | "updated";
    action_step_outcome: "assigned" | "mastered" | "none";
  };
  draft_saved: undefined;
  draft_resumed: undefined;
  draft_discarded: undefined;
  school_selected: {
    selection_scope: "network";
  };
  rubric_selected: {
    rubric_target: "school" | "teacher";
    subject_audience: "all" | "stem" | "humanities";
  };
  teacher_switched: {
    had_unsaved_content: boolean;
  };
};

export type AnalyticsEventName = keyof AnalyticsEventProperties;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: Record<string, AnalyticsValue>): void;
    };
  }
}

/**
 * Records only the app's approved, privacy-safe custom events. Analytics is
 * optional and must never affect the observation workflow.
 */
export function trackEvent<Name extends AnalyticsEventName>(
  name: Name,
  ...[data]: AnalyticsEventProperties[Name] extends undefined
    ? [data?: undefined]
    : [data: AnalyticsEventProperties[Name]]
): void {
  if (typeof window === "undefined") return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the app.
  }
}