/**
 * The time a server page is being rendered for, in epoch milliseconds.
 *
 * A server component renders once per request, so reading the clock there is
 * correct, not a purity bug: there is no re-render for the value to drift
 * across. eslint-plugin-react-hooks 7 can't tell a server component from a
 * client one and flags a bare `Date.now()` in either, so pages ask for the time
 * here instead — the call site then says what it means, and the one place that
 * reads the clock is this function. Not for client components: there, state
 * (or an effect) is the right way to get a time that must not change per render.
 */
export function requestTime(): number {
  return Date.now();
}
