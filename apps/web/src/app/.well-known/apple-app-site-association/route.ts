// iOS universal links for the customer app (M13). APPLE_TEAM_ID is set per environment once the
// Apple developer account exists; without it the file lists no apps (links open the website).
export const dynamic = 'force-dynamic';

const PATHS = ['/bookings/*', '/review/*', '/r/*', '/m/*', '/*'];
const EXCLUDE = ['/biz/*', '/api/*', '/captcha', '/lab/*', '/invite/*', '/account/*'];

export function GET() {
  const team = process.env.APPLE_TEAM_ID;
  const appIDs = team ? [`${team}.com.appname.customer`] : [];
  const components = [...EXCLUDE.map((p) => ({ '/': p, exclude: true })), ...PATHS.map((p) => ({ '/': p }))];
  return Response.json({ applinks: { details: appIDs.length ? [{ appIDs, components }] : [] } });
}
