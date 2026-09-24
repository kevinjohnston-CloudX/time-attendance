/**
 * The cookie the Employees list remembers its search, filters and page in, for
 * this browser session. Its own module because both sides read the name: the
 * list (a client component) writes it, the list page (on the server) reads it,
 * and a constant imported from a client module is not a plain string on the
 * server.
 */
export const LIST_COOKIE = "ta_employees_list";
