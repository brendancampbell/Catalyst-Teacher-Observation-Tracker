import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";

const NAVY  = "#1034B4";
const BASE  = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function PlaceholderBlock({ heading, body }: { heading: string; body: string }) {
  return (
    <div
      className="rounded-xl p-6"
      style={{ backgroundColor: "#f5f7ff", border: "1.5px dashed #c7d2f5" }}
    >
      <h2 className="text-lg font-bold mb-2" style={{ color: NAVY }}>{heading}</h2>
      <p className="text-sm" style={{ color: "#6b7280" }}>{body}</p>
    </div>
  );
}

export default function SupportPage() {
  const { currentUser } = useUser();
  const role = currentUser?.role;

  let pageTitle   = "Support";
  let intro       = "Find help and guidance for using Catalyst.";
  let sections: { heading: string; body: string }[] = [];

  if (role === "COACH") {
    pageTitle = "Coach Support";
    intro     = "Guidance and how-to resources for coaches using the Catalyst observation tool.";
    sections  = [
      {
        heading: "Submitting an Observation",
        body:    "Step-by-step guide on creating, saving, and publishing an observation from the mobile app. Content coming soon.",
      },
      {
        heading: "Action Steps",
        body:    "How to assign, track, and mark action steps as mastered. Content coming soon.",
      },
      {
        heading: "Drafts",
        body:    "How to resume and manage draft observations. Content coming soon.",
      },
    ];
  } else if (role === "SCHOOL_LEADER") {
    pageTitle = "School Leader Support";
    intro     = "Resources for school leaders reviewing observation data and managing coaching cycles.";
    sections  = [
      {
        heading: "Reading the Dashboard",
        body:    "Understanding observation scores, domain breakdowns, and trend charts. Content coming soon.",
      },
      {
        heading: "Action Center",
        body:    "How to review open and overdue action steps across your school. Content coming soon.",
      },
      {
        heading: "Teacher Profiles",
        body:    "Navigating individual teacher history and coaching notes. Content coming soon.",
      },
    ];
  } else if (role === "NETWORK_LEADER" || role === "NETWORK_ADMIN") {
    pageTitle = role === "NETWORK_ADMIN" ? "Network Admin Support" : "Network Leader Support";
    intro     = "Resources for network-wide oversight of observation data and rubric management.";
    sections  = [
      {
        heading: "Network Dashboard",
        body:    "How to view and filter observation data across multiple schools. Content coming soon.",
      },
      {
        heading: "Rubric Management",
        body:    "Creating and editing rubric sets, domains, and categories in the admin panel. Content coming soon.",
      },
      {
        heading: "People & Access",
        body:    "Managing user accounts, roles, and school assignments. Content coming soon.",
      },
    ];
  } else {
    sections = [
      {
        heading: "Getting Started",
        body:    "General guidance for using Catalyst. Content coming soon.",
      },
    ];
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB" }}>
      <AppHeader
        basePath={BASE}
        backHref={BASE || "/"}
        backLabel="Dashboard"
        userName={currentUser?.name ?? ""}
        userEmail={currentUser?.email}
        userRole={currentUser?.role ?? ""}
        canAdmin={currentUser?.role !== "COACH"}
        draftsHref={`${BASE}/drafts`}
      />

      <main className="flex-1 px-4 sm:px-8 py-8 max-w-2xl mx-auto w-full">
        <div className="mb-8">
          <h1
            className="uppercase leading-none mb-2"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 38, letterSpacing: "0.04em", color: NAVY }}
          >
            {pageTitle}
          </h1>
          <p className="text-sm" style={{ color: "#6b7280" }}>{intro}</p>
        </div>

        <div className="flex flex-col gap-4">
          {sections.map((s) => (
            <PlaceholderBlock key={s.heading} heading={s.heading} body={s.body} />
          ))}
        </div>

        <p className="mt-10 text-xs text-center" style={{ color: "#94a3b8" }}>
          Need immediate help? Reach out to your network's Catalyst administrator.
        </p>
      </main>
    </div>
  );
}
