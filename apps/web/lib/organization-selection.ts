const KEY = 'cka.activeOrganizationId';

let selected: string | null | undefined;

/**
 * The organization the user picked in the UI. Only a hint sent as the
 * X-Organization-Id header: the API checks it against the user's memberships.
 */
export function getSelectedOrganization(): string | null {
  if (selected === undefined) {
    try {
      selected = window.localStorage.getItem(KEY);
    } catch {
      selected = null;
    }
  }
  return selected;
}

export function setSelectedOrganization(id: string | null): void {
  selected = id;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the selection lasts for this page only.
  }
}
