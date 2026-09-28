import { StaffDetail } from './staff-detail';

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  return <StaffDetail staffId={staffId} />;
}
