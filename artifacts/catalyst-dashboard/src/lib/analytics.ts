/**
 * Privacy-safe custom analytics for the dashboard. Keep this event map limited
 * to aggregate outcome dimensions; never add user, school, observation, or
 * generated-content data here.
 */
type AnalyticsData = Record<string, string | number | boolean>;

type AnalyticsEventData = {
  observation_submitted: {
    surface: "dashboard";
    observation_kind: "observation" | "walkthrough";
    outcome: "created" | "updated";
    action_step_outcome: "assigned" | "mastered" | "extended" | "none";
  };
  draft_saved: { surface: "dashboard" };
  draft_resumed: { surface: "dashboard" };
  draft_discarded: { surface: "dashboard" };
  feedback_email_copied: { surface: "dashboard" };
  ai_chat_completed: {
    surface: "action_center";
    result: "success" | "error" | "aborted";
    has_structured_results: boolean;
  };
  ai_analysis_completed: {
    surface: "action_center";
    result: "success" | "error" | "aborted";
    has_structured_results: boolean;
  };
};

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

export function trackEvent<Name extends keyof AnalyticsEventData>(
  name: Name,
  data: AnalyticsEventData[Name],
): void {
  if (typeof window === "undefined") return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never affect a dashboard workflow.
  }
}