/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/geotiff_writer.js — a minimal, dependency-free writer for a
 * single-band Float32 GeoTIFF in EPSG:4326.
 *
 * geotiff.js can read GeoTIFFs but its writer mishandles floating-point bands
 * (it defaults to 8-bit and truncates, and its float path produces a file it
 * can't even read back). A result grid is small and the layout we need is
 * fixed, so writing the ~14-tag TIFF by hand is simpler and correct.
 *
 * Layout: little-endian TIFF header → one IFD (tags in ascending order) → the
 * tag values that don't fit inline (georeferencing doubles, the GeoKey
 * directory, the GDAL nodata string) → the Float32 pixel strip.
 */

const T = { SHORT: 3, LONG: 4, ASCII: 2, DOUBLE: 12 };

/**
 * @param values  Float32Array | number[] of length width*height, row-major,
 *                top-left origin. Non-finite values are written as `nodata`.
 * @param opts    { width, height, west, north, pixelW, pixelH, nodata? }
 *                west/north = top-left corner; pixelW/pixelH = degrees per pixel.
 * @returns ArrayBuffer of the GeoTIFF.
 */
export function buildGeoTiff(values, opts) {
  const { width, height, west, north, pixelW, pixelH, nodata = -9999 } = opts;
  const LE = true;

  const pixelScale = [pixelW, pixelH, 0];                  /* 3 doubles */
  const tiepoint = [0, 0, 0, west, north, 0];              /* 6 doubles */
  /* GeoKeyDirectory: header(1,1,0,nKeys) then {keyId, loc=0, count=1, value}. */
  const geoKeys = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326];
  const nodataStr = `${nodata}\0`;                         /* ASCII, null-terminated */

  const N_ENTRIES = 14;
  const ifdStart = 8;
  let cur = ifdStart + 2 + N_ENTRIES * 12 + 4;             /* IFD end */
  const psOff = cur; cur += pixelScale.length * 8;
  const tpOff = cur; cur += tiepoint.length * 8;
  const gkOff = cur; cur += geoKeys.length * 2;
  const ndOff = cur; cur += nodataStr.length;
  if (cur % 4) cur += 4 - (cur % 4);                       /* align float strip */
  const dataOff = cur;
  const dataBytes = width * height * 4;

  const dv = new DataView(new ArrayBuffer(dataOff + dataBytes));

  /* Header */
  dv.setUint16(0, 0x4949, LE);        /* 'II' little-endian */
  dv.setUint16(2, 42, LE);
  dv.setUint32(4, ifdStart, LE);

  /* IFD */
  dv.setUint16(ifdStart, N_ENTRIES, LE);
  let e = ifdStart + 2;
  const entry = (tag, type, count, val) => {
    dv.setUint16(e, tag, LE); dv.setUint16(e + 2, type, LE);
    dv.setUint32(e + 4, count, LE); dv.setUint32(e + 8, val >>> 0, LE);
    e += 12;
  };
  /* SHORT count-1 values sit in the low 2 bytes of the 4-byte field (LE). */
  entry(256, T.LONG, 1, width);        /* ImageWidth */
  entry(257, T.LONG, 1, height);       /* ImageLength */
  entry(258, T.SHORT, 1, 32);          /* BitsPerSample */
  entry(259, T.SHORT, 1, 1);           /* Compression: none */
  entry(262, T.SHORT, 1, 1);           /* Photometric: BlackIsZero */
  entry(273, T.LONG, 1, dataOff);      /* StripOffsets */
  entry(277, T.SHORT, 1, 1);           /* SamplesPerPixel */
  entry(278, T.LONG, 1, height);       /* RowsPerStrip (one strip) */
  entry(279, T.LONG, 1, dataBytes);    /* StripByteCounts */
  entry(339, T.SHORT, 1, 3);           /* SampleFormat: IEEE float */
  entry(33550, T.DOUBLE, 3, psOff);    /* ModelPixelScale */
  entry(33922, T.DOUBLE, 6, tpOff);    /* ModelTiepoint */
  entry(34735, T.SHORT, geoKeys.length, gkOff);   /* GeoKeyDirectory */
  entry(42113, T.ASCII, nodataStr.length, ndOff); /* GDAL_NODATA */
  dv.setUint32(e, 0, LE);              /* next IFD: none */

  /* Out-of-line tag values */
  pixelScale.forEach((v, i) => dv.setFloat64(psOff + i * 8, v, LE));
  tiepoint.forEach((v, i) => dv.setFloat64(tpOff + i * 8, v, LE));
  geoKeys.forEach((v, i) => dv.setUint16(gkOff + i * 2, v, LE));
  for (let i = 0; i < nodataStr.length; i++) dv.setUint8(ndOff + i, nodataStr.charCodeAt(i));

  /* Pixel strip */
  for (let i = 0; i < width * height; i++) {
    const v = values[i];
    dv.setFloat32(dataOff + i * 4, Number.isFinite(v) ? v : nodata, LE);
  }
  return dv.buffer;
}
