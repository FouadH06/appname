import sharp from 'sharp';

// Independent leak check for processor outputs (tests + benchmark): the WebP container is walked
// chunk by chunk (EXIF / XMP / ICCP chunks = metadata), libvips is asked what metadata it sees, and
// the bytes are scanned for EXIF/XMP markers. (exifr can't read WebP, so it isn't used here.)

export function webpChunks(buf: Buffer): string[] {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP file');
  }
  const out: string[] = [];
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    out.push(id);
    off += 8 + size + (size % 2); // chunks are padded to even sizes
  }
  return out;
}

export async function metadataLeaks(buf: Buffer): Promise<string[]> {
  const leaks: string[] = [];
  const chunks = webpChunks(buf);
  for (const c of ['EXIF', 'XMP ', 'ICCP']) if (chunks.includes(c)) leaks.push(`chunk:${c.trim()}`);
  const m = await sharp(buf).metadata();
  if (m.exif?.length) leaks.push('vips:exif');
  if (m.xmp?.length) leaks.push('vips:xmp');
  if (m.iptc?.length) leaks.push('vips:iptc');
  if (m.icc?.length) leaks.push('vips:icc');
  if (m.orientation && m.orientation !== 1) leaks.push('vips:orientation');
  const ascii = buf.toString('latin1');
  if (ascii.includes('Exif\0\0')) leaks.push('marker:Exif');
  if (ascii.includes('<x:xmpmeta') || ascii.includes('http://ns.adobe.com/xap'))
    leaks.push('marker:XMP');
  if (ascii.includes('GPSLatitude') || ascii.includes('TestPhone')) leaks.push('marker:camera/gps');
  return leaks;
}

/** What metadata an input file carries (to prove the corpus exercises stripping). */
export async function inputMetadata(buf: Buffer) {
  const m = await sharp(buf).metadata();
  return {
    exif: !!m.exif?.length,
    orientation: m.orientation ?? 1,
    gps: buf.toString('latin1').includes('TestPhone'),
  };
}
