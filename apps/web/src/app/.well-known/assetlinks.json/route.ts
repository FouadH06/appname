// Android App Links for the customer app (M13). ANDROID_CERT_SHA256 (comma-separated fingerprints of
// the Play signing key) is set per environment; without it no app is verified.
export const dynamic = 'force-dynamic';

export function GET() {
  const prints = (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Response.json(
    prints.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: 'com.appname.customer',
              sha256_cert_fingerprints: prints,
            },
          },
        ]
      : [],
  );
}
