/**
 * Grade levels.
 *
 * The rules live in @workspace/api-types so the import, the create/edit
 * endpoints and the cleanup script in lib/db all enforce exactly the same
 * thing. They did not, once: the cleanup carried its own copy, could not read
 * "5-6-7-8", and reported thirty people as unrepairable who were not.
 *
 * This re-export keeps the existing import path working.
 */

export {
  isValidGrade,
  repairExcelDate,
  parseGradeLevels,
  parseGradeLevelsDetailed,
  type GradeParseResult,
} from "@workspace/api-types";
