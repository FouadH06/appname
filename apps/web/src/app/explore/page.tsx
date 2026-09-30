import type { Metadata } from 'next';
import Link from 'next/link';
import { CustomerShell } from '@/components/customer/shell';
import { getReference } from '@/lib/public/search';

// C3 browse (web): categories → services, and links to the area landing pages (/{area}/{category}).
export const metadata: Metadata = {
  title: 'Explore beauty & grooming services · APP_NAME',
  description:
    'Hair salons, barbers, nails, lashes & brows, makeup and spas in Achrafieh, Hamra, Hazmieh and nearby.',
};
export const revalidate = 300;

interface Category {
  id: string;
  slug: string;
  name_en: string;
  parent_id: string | null;
}
interface Service {
  id: string;
  name_en: string;
  category_id: string;
}
interface Area {
  slug: string;
  name_en: string;
}

export default async function Explore() {
  const [cats, services, areas] = await Promise.all([
    getReference<Category[]>(
      'categories?select=id,slug,name_en,parent_id&is_live=eq.true&parent_id=not.is.null&order=sort',
      [],
    ),
    getReference<Service[]>(
      'canonical_services?select=id,name_en,category_id&is_active=eq.true&order=sort',
      [],
    ),
    getReference<Area[]>(
      'areas?select=slug,name_en&is_live=eq.true&level=eq.area&order=name_en',
      [],
    ),
  ]);
  return (
    <CustomerShell>
      <main className="mx-auto flex w-full max-w-[1320px] flex-col sm:px-6 lg:px-8 lg:py-10 gap-6 px-4 py-6">
        <h1 className="text-xl font-semibold">Explore</h1>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="explore">
          {cats.map((c) => (
            <section key={c.id} className="rounded-card border border-line-200 bg-surface-0 p-4">
              <h2 className="font-semibold">
                <Link
                  href={`/search?${new URLSearchParams({ category: c.id, q: c.name_en }).toString()}`}
                  className="hover:underline"
                >
                  {c.name_en}
                </Link>
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                {services
                  .filter((s) => s.category_id === c.id)
                  .map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/search?${new URLSearchParams({ service: s.id, q: s.name_en }).toString()}`}
                        className="rounded-full bg-surface-100 px-3 py-1"
                      >
                        {s.name_en}
                      </Link>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500">
                {areas.map((a) => (
                  <Link key={a.slug} href={`/${a.slug}/${c.slug}`} className="hover:underline">
                    {c.name_en} in {a.name_en}
                  </Link>
                ))}
              </p>
            </section>
          ))}
        </div>
      </main>
    </CustomerShell>
  );
}
