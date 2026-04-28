/** Barrel for table chrome. Pure RSC table + filter chip strip — both
 * URL-state driven so they slot into any RSC page without client glue. */

export {
  DataTable,
  type Column,
  type ColumnAlign,
  type ColumnHideBelow,
  type Pagination,
} from "./DataTable";
export { Filters, type Chip } from "./Filters";
export { PageLink } from "./PageLink";
