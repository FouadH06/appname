import type { ReactNode } from 'react';
import { BizLayoutClient } from './layout-client';

export default async function BusinessLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  return <BizLayoutClient businessId={businessId}>{children}</BizLayoutClient>;
}
