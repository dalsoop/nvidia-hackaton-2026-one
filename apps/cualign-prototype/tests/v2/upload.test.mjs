import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_ERROR_CODES,
  scanFileName,
  validateScanFiles
} from '../../src/cualign/server/static/v2/js/screens/intake/upload.js';

test('Scan file name parser: Universal, gingiva, lower, and other files', () => {
  // Maxillary upper teeth (1..16)
  assert.deepEqual(scanFileName('2.stl'), { name: '2.stl', kind: 'tooth', toothNumber: 2, rawName: '2.stl' });
  assert.deepEqual(scanFileName('15.stl'), { name: '15.stl', kind: 'tooth', toothNumber: 15, rawName: '15.stl' });
  assert.deepEqual(scanFileName('8.STL'), { name: '8.stl', kind: 'tooth', toothNumber: 8, rawName: '8.STL' });

  // Gingiva
  assert.deepEqual(scanFileName('gingiva.stl'), { name: 'gingiva.stl', kind: 'gum', toothNumber: null, rawName: 'gingiva.stl' });
  assert.deepEqual(scanFileName('Gingiva.STL'), { name: 'gingiva.stl', kind: 'gum', toothNumber: null, rawName: 'Gingiva.STL' });

  // Lower teeth (Universal 17..32)
  assert.deepEqual(scanFileName('17.stl'), { name: null, kind: 'lower', toothNumber: 17, rawName: '17.stl' });
  assert.deepEqual(scanFileName('32.stl'), { name: null, kind: 'lower', toothNumber: 32, rawName: '32.stl' });

  // Padded numbers are not tooth numbers (e.g. scan ID "000018.stl")
  assert.deepEqual(scanFileName('000018.stl'), { name: null, kind: 'other', toothNumber: null, rawName: '000018.stl' });
  assert.deepEqual(scanFileName('02.stl'), { name: null, kind: 'other', toothNumber: null, rawName: '02.stl' });

  // Other non-tooth files
  assert.deepEqual(scanFileName('upper_arch.stl'), { name: null, kind: 'other', toothNumber: null, rawName: 'upper_arch.stl' });
  assert.deepEqual(scanFileName('scan.ply'), { name: null, kind: 'other', toothNumber: null, rawName: 'scan.ply' });
});

test('Upload validation: 1. 정상 (Valid upper arch scan files)', () => {
  const normalFiles = [
    { name: '2.stl', size: 1024 * 500 },
    { name: '3.stl', size: 1024 * 600 },
    { name: '4.stl', size: 1024 * 550 },
    { name: '5.stl', size: 1024 * 510 },
    { name: '6.stl', size: 1024 * 490 },
    { name: '7.stl', size: 1024 * 480 },
    { name: '8.stl', size: 1024 * 520 },
    { name: '9.stl', size: 1024 * 520 },
    { name: '10.stl', size: 1024 * 480 },
    { name: '11.stl', size: 1024 * 490 },
    { name: '12.stl', size: 1024 * 510 },
    { name: '13.stl', size: 1024 * 550 },
    { name: '14.stl', size: 1024 * 600 },
    { name: '15.stl', size: 1024 * 500 },
    { name: 'gingiva.stl', size: 1024 * 1200 }
  ];

  const result = validateScanFiles(normalFiles);
  assert.equal(result.valid, true);
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.code, null);
  assert.equal(result.hasGingiva, true);
  assert.equal(result.teeth.length, 14);
  assert.deepEqual(result.teeth, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
});

test('Upload validation: 2. 하악 (Universal 17..32 lower arch teeth rejected)', () => {
  const lowerFiles = [
    { name: '2.stl', size: 1024 },
    { name: '3.stl', size: 1024 },
    { name: '18.stl', size: 1024 },
    { name: '19.stl', size: 1024 }
  ];

  const result = validateScanFiles(lowerFiles);
  assert.equal(result.valid, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, UPLOAD_ERROR_CODES.LOWER_ARCH);
  assert.match(result.error, /하악\(Universal 17~32\)/);
  assert.match(result.error, /18\.stl/);
});

test('Upload validation: 3. 중복 (Duplicate tooth numbers rejected)', () => {
  const duplicateFiles = [
    { name: '2.stl', size: 1024 },
    { name: '3.stl', size: 1024 },
    { name: '2.stl', size: 1024 }
  ];

  const result = validateScanFiles(duplicateFiles);
  assert.equal(result.valid, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, UPLOAD_ERROR_CODES.DUPLICATE_TOOTH);
  assert.match(result.error, /2\.stl: 같은 번호의 파일이 두 개 있습니다/);
});

test('Upload validation: 4. 크기 (Single file > 60MB or total > 400MB rejected)', () => {
  // 4-a: Single file exceeds 60MB
  const singleOversize = [
    { name: '2.stl', size: 61 * 1024 * 1024 },
    { name: '3.stl', size: 1024 }
  ];
  const resSingle = validateScanFiles(singleOversize);
  assert.equal(resSingle.valid, false);
  assert.equal(resSingle.ok, false);
  assert.equal(resSingle.code, UPLOAD_ERROR_CODES.SIZE_EXCEEDED);
  assert.match(resSingle.error, /파일이 너무 큽니다/);
  assert.match(resSingle.error, /60MB/);

  // 4-b: Total exceeds 400MB
  const totalOversize = [
    { name: '2.stl', size: 55 * 1024 * 1024 },
    { name: '3.stl', size: 55 * 1024 * 1024 },
    { name: '4.stl', size: 55 * 1024 * 1024 },
    { name: '5.stl', size: 55 * 1024 * 1024 },
    { name: '6.stl', size: 55 * 1024 * 1024 },
    { name: '7.stl', size: 55 * 1024 * 1024 },
    { name: '8.stl', size: 55 * 1024 * 1024 },
    { name: '9.stl', size: 55 * 1024 * 1024 }  // 8 * 55 = 440MB > 400MB
  ];
  const resTotal = validateScanFiles(totalOversize);
  assert.equal(resTotal.valid, false);
  assert.equal(resTotal.ok, false);
  assert.equal(resTotal.code, UPLOAD_ERROR_CODES.SIZE_EXCEEDED);
  assert.match(resTotal.error, /400MB/);
});

test('Upload validation: 5. 한 덩어리 스캔 (Monolithic whole-arch meshes rejected)', () => {
  const monolithicFiles = [
    { name: 'upper_arch_scan.stl', size: 5 * 1024 * 1024 }
  ];

  const result = validateScanFiles(monolithicFiles);
  assert.equal(result.valid, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, UPLOAD_ERROR_CODES.MONOLITHIC_SCAN);
  assert.match(result.error, /한 덩어리 악궁 스캔으로 보입니다/);
  assert.match(result.error, /upper_arch_scan\.stl/);

  // PLY / OBJ files
  const objFiles = [
    { name: 'maxilla.obj', size: 2 * 1024 * 1024 }
  ];
  const resObj = validateScanFiles(objFiles);
  assert.equal(resObj.valid, false);
  assert.equal(resObj.code, UPLOAD_ERROR_CODES.MONOLITHIC_SCAN);
});

test('Upload validation: 치아 파일 없음 및 빈 목록 거절', () => {
  // Only gingiva without tooth STL
  const onlyGingiva = [
    { name: 'gingiva.stl', size: 1024 }
  ];
  const resGingiva = validateScanFiles(onlyGingiva);
  assert.equal(resGingiva.valid, false);
  assert.equal(resGingiva.code, UPLOAD_ERROR_CODES.NO_TEETH);
  assert.match(resGingiva.error, /치아별 STL/);

  // Empty file list
  const emptyRes = validateScanFiles([]);
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.code, UPLOAD_ERROR_CODES.EMPTY);
});
