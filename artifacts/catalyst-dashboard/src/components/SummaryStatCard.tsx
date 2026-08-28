import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

/**
 * A stat card on an action center summary.
 *
 * The shell only — icon, title, and whatever the card has to say. Two
 * summaries use it now, one for a school and one for the network, and they
 * should be the same card rather than the same design copied twice.
 */
export function SummaryStatCard({
  icon, title, children,
}: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="px-5 pt-5 pb-3 min-h-[60px] flex flex-col justify-center">
        <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
          <span style={{ color: YELLOW }} className="flex items-center">{icon}</span> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">{children}</CardContent>
    </Card>
  );
}

/** The em dash and explanation a card shows before there is anything to say. */
export function NoStatYet({ note = "No observation data yet" }: { note?: string }) {
  return (
    <>
      <p className="text-2xl font-bold text-slate-300" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>—</p>
      <p className="text-sm text-slate-500 mt-1">{note}</p>
    </>
  );
}
