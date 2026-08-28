import { describe, it, expect } from "vitest";
import { canEditObservation } from "@/lib/observation-permissions";

const obs = (observerEmployeeId: string | null) => ({ observerEmployeeId });

const coach  = (employeeId: string | null) => ({ role: "COACH", employeeId });
const leader = { role: "SCHOOL_LEADER",  employeeId: "L1" };
const teacher = { role: "NO_ACCESS", employeeId: "T1" };

describe("who may correct or remove an observation", () => {
  it("lets a coach at their own work", () => {
    expect(canEditObservation(obs("C1"), coach("C1"))).toBe(true);
  });

  it("does not let a coach near somebody else's", () => {
    expect(canEditObservation(obs("C2"), coach("C1"))).toBe(false);
  });

  it("lets a school leader at anything they can see", () => {
    /* Which school is the server's business — it holds the observation's
       frozen schoolId and checks it. This only decides the buttons. */
    expect(canEditObservation(obs("C1"), leader)).toBe(true);
  });

  it("lets network roles through", () => {
    expect(canEditObservation(obs("C1"), { role: "NETWORK_LEADER", employeeId: "N1" })).toBe(true);
    expect(canEditObservation(obs("C1"), { role: "NETWORK_ADMIN",  employeeId: "N2" })).toBe(true);
  });

  it("does not let a teacher edit an observation of themselves", () => {
    expect(canEditObservation(obs("C1"), teacher)).toBe(false);
  });

  describe("when somebody is missing an id", () => {
    /* Legacy rows carry no observer. Two nulls must not read as a match, or
       every one of them would be handed to anybody without an employee id. */
    it("does not match a null observer to a null employee id", () => {
      expect(canEditObservation(obs(null), coach(null))).toBe(false);
    });

    it("does not match a null observer to a real coach", () => {
      expect(canEditObservation(obs(null), coach("C1"))).toBe(false);
    });

    it("still lets a school leader at an observation with no observer", () => {
      expect(canEditObservation(obs(null), leader)).toBe(true);
    });
  });

  it("says no when nobody is signed in", () => {
    expect(canEditObservation(obs("C1"), null)).toBe(false);
    expect(canEditObservation(obs("C1"), undefined)).toBe(false);
  });

  it("says no when there is no observation", () => {
    expect(canEditObservation(null, coach("C1"))).toBe(false);
  });
});
