export function matchRoutePattern(routes, hash) {
  const normalized = hash && hash.startsWith('#/') ? hash : '#/cases';
  const pathParts = normalized.split('/');

  for (const route of routes) {
    const routeParts = route.pattern.split('/');
    if (pathParts.length !== routeParts.length) continue;

    const params = {};
    let matched = true;
    for (let index = 0; index < routeParts.length; index += 1) {
      if (routeParts[index].startsWith(':')) {
        params[routeParts[index].slice(1)] = decodeURIComponent(pathParts[index]);
      } else if (routeParts[index] !== pathParts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }

  return { route: routes[0], params: {} };
}
