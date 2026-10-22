/**
 * Regenerates src/config/muscleMap.json from BodyExplorer's mesh_mapping.json.
 *
 * BodyExplorer loads `public/anatomy.glb` and identifies every mesh by its GLB
 * node name (`mesh.userData.muscleData.rawName`). three.js GLTFLoader rewrites
 * spaces in node names to underscores, which is why the ids emitted here are the
 * underscored form of `mesh_mapping.json`'s `name` field.
 *
 * Usage:
 *   node scripts/generate-muscle-map.mjs ../app/BodyExplorer/public/mesh_mapping.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MAPPING = resolve(HERE, '../../app/BodyExplorer/public/mesh_mapping.json');
const OUTPUT = resolve(HERE, '../src/config/muscleMap.json');

/**
 * Canonical AI-facing muscle names -> how to find their meshes.
 * `any` = mesh name must contain one of these substrings.
 * `not` = mesh name must contain none of these substrings.
 * `sided: false` = single midline structure, emitted without a Left/Right prefix.
 */
const DEFINITIONS = [
  { name: 'Trapezius', group: 'BACK', any: ['trapezius'] },
  { name: 'Levator Scapulae', group: 'SHOULDER', any: ['levator scapulae'] },
  { name: 'Rhomboid Major', group: 'BACK', any: ['rhomboid major'] },
  { name: 'Rhomboid Minor', group: 'BACK', any: ['rhomboid minor'] },
  { name: 'Latissimus Dorsi', group: 'BACK', any: ['latissimus dorsi'] },
  { name: 'Serratus Anterior', group: 'CHEST', any: ['serratus anterior'] },
  { name: 'Serratus Posterior Superior', group: 'BACK', any: ['serratus posterior superior'] },
  { name: 'Serratus Posterior Inferior', group: 'BACK', any: ['serratus posterior inferior'] },
  { name: 'Sternocleidomastoid', group: 'HEAD_NECK', any: ['sternocleidomastoid'] },
  { name: 'Scalenus Anterior', group: 'HEAD_NECK', any: ['scalenus anterior'] },
  { name: 'Scalenus Medius', group: 'HEAD_NECK', any: ['scalenus medius'] },
  { name: 'Scalenus Posterior', group: 'HEAD_NECK', any: ['scalenus posterior'] },
  { name: 'Splenius Capitis', group: 'HEAD_NECK', any: ['splenius capitis'] },
  { name: 'Splenius Cervicis', group: 'HEAD_NECK', any: ['splenius cervicis'] },
  { name: 'Semispinalis Capitis', group: 'BACK', any: ['semispinalis capitis'] },
  { name: 'Semispinalis Cervicis', group: 'BACK', any: ['semispinalis cervicis'] },
  { name: 'Masseter', group: 'HEAD_NECK', any: ['masseter'] },
  { name: 'Temporalis', group: 'HEAD_NECK', any: ['temporalis'] },

  { name: 'Deltoid', group: 'SHOULDER', any: ['deltoid'] },
  { name: 'Supraspinatus', group: 'SHOULDER', any: ['supraspinatus'] },
  { name: 'Infraspinatus', group: 'SHOULDER', any: ['infraspinatus'] },
  { name: 'Teres Major', group: 'SHOULDER', any: ['teres major'] },
  { name: 'Teres Minor', group: 'SHOULDER', any: ['teres minor'] },
  { name: 'Subscapularis', group: 'SHOULDER', any: ['subscapularis'] },
  { name: 'Subclavius', group: 'SHOULDER', any: ['subclavius'] },
  { name: 'Pectoralis Major', group: 'CHEST', any: ['pectoralis major'] },
  { name: 'Pectoralis Minor', group: 'CHEST', any: ['pectoralis minor'] },

  { name: 'Biceps Brachii', group: 'UPPER_ARM', any: ['biceps brachii'] },
  { name: 'Triceps Brachii', group: 'UPPER_ARM', any: ['triceps brachii'] },
  { name: 'Brachialis', group: 'UPPER_ARM', any: ['brachialis'], not: ['brachioradialis', 'coracobrachialis'] },
  { name: 'Coracobrachialis', group: 'UPPER_ARM', any: ['coracobrachialis'] },
  { name: 'Anconeus', group: 'UPPER_ARM', any: ['anconeus'] },
  { name: 'Brachioradialis', group: 'FOREARM', any: ['brachioradialis'] },
  { name: 'Pronator Teres', group: 'FOREARM', any: ['pronator teres'] },
  { name: 'Pronator Quadratus', group: 'FOREARM', any: ['pronator quadratus'] },
  { name: 'Supinator', group: 'FOREARM', any: ['supinator'] },
  { name: 'Flexor Carpi Radialis', group: 'FOREARM', any: ['flexor carpi radialis'] },
  { name: 'Flexor Carpi Ulnaris', group: 'FOREARM', any: ['flexor carpi ulnaris'] },
  { name: 'Extensor Carpi Radialis Longus', group: 'FOREARM', any: ['extensor carpi radialis longus'] },
  { name: 'Extensor Carpi Radialis Brevis', group: 'FOREARM', any: ['extensor carpi radialis brevis'] },
  { name: 'Extensor Carpi Ulnaris', group: 'FOREARM', any: ['extensor carpi ulnaris'] },
  { name: 'Palmaris Longus', group: 'FOREARM', any: ['palmaris longus'] },

  { name: 'Rectus Abdominis', group: 'ABDOMEN', any: ['rectus abdominis'] },
  { name: 'External Oblique', group: 'ABDOMEN', any: ['external oblique'] },
  { name: 'Internal Oblique', group: 'ABDOMEN', any: ['internal oblique'] },
  { name: 'Transversus Abdominis', group: 'ABDOMEN', any: ['transversus abdominis'] },
  { name: 'Quadratus Lumborum', group: 'BACK', any: ['quadratus lumborum'] },
  { name: 'Iliocostalis', group: 'BACK', any: ['iliocostalis'] },
  { name: 'Longissimus', group: 'BACK', any: ['longissimus'] },
  { name: 'Spinalis', group: 'BACK', any: ['spinalis'], not: ['semispinalis'] },
  { name: 'Multifidus', group: 'BACK', any: ['multifidus'] },
  { name: 'Psoas Major', group: 'HIP', any: ['psoas major'] },
  { name: 'Iliacus', group: 'HIP', any: ['iliacus'] },
  { name: 'Diaphragm', group: 'TRUNK', any: ['diaphragm'], sided: false },

  { name: 'Gluteus Maximus', group: 'HIP', any: ['gluteus maximus'] },
  { name: 'Gluteus Medius', group: 'HIP', any: ['gluteus medius'] },
  { name: 'Gluteus Minimus', group: 'HIP', any: ['gluteus minimus'] },
  { name: 'Piriformis', group: 'HIP', any: ['piriformis'] },
  { name: 'Tensor Fasciae Latae', group: 'HIP', any: ['tensor fasciae latae', 'tensor of fascia lata'] },
  { name: 'Obturator Internus', group: 'HIP', any: ['obturator internus'] },
  { name: 'Obturator Externus', group: 'HIP', any: ['obturator externus'] },
  { name: 'Quadratus Femoris', group: 'HIP', any: ['quadratus femoris'] },
  { name: 'Pectineus', group: 'HIP', any: ['pectineus'] },
  { name: 'Sartorius', group: 'UPPER_LEG', any: ['sartorius'] },
  { name: 'Gracilis', group: 'UPPER_LEG', any: ['gracilis'] },
  { name: 'Adductor Longus', group: 'UPPER_LEG', any: ['adductor longus'] },
  { name: 'Adductor Brevis', group: 'UPPER_LEG', any: ['adductor brevis'] },
  { name: 'Adductor Magnus', group: 'UPPER_LEG', any: ['adductor magnus'] },
  { name: 'Rectus Femoris', group: 'UPPER_LEG', any: ['rectus femoris'] },
  { name: 'Vastus Lateralis', group: 'UPPER_LEG', any: ['vastus lateralis'] },
  { name: 'Vastus Medialis', group: 'UPPER_LEG', any: ['vastus medialis'] },
  { name: 'Vastus Intermedius', group: 'UPPER_LEG', any: ['vastus intermedius'] },
  { name: 'Biceps Femoris', group: 'UPPER_LEG', any: ['biceps femoris'] },
  { name: 'Semitendinosus', group: 'UPPER_LEG', any: ['semitendinosus'] },
  { name: 'Semimembranosus', group: 'UPPER_LEG', any: ['semimembranosus'] },

  { name: 'Gastrocnemius', group: 'LOWER_LEG', any: ['gastrocnemius'] },
  { name: 'Soleus', group: 'LOWER_LEG', any: ['soleus'] },
  { name: 'Popliteus', group: 'LOWER_LEG', any: ['popliteus'] },
  { name: 'Tibialis Anterior', group: 'LOWER_LEG', any: ['tibialis anterior'] },
  { name: 'Tibialis Posterior', group: 'LOWER_LEG', any: ['tibialis posterior'] },
  { name: 'Fibularis Longus', group: 'LOWER_LEG', any: ['fibularis longus', 'peroneus longus'] },
  { name: 'Fibularis Brevis', group: 'LOWER_LEG', any: ['fibularis brevis', 'peroneus brevis'] },
  { name: 'Extensor Digitorum Longus', group: 'LOWER_LEG', any: ['extensor digitorum longus'] },
  { name: 'Flexor Digitorum Longus', group: 'LOWER_LEG', any: ['flexor digitorum longus'], not: ['hand'] },
  { name: 'Flexor Hallucis Longus', group: 'LOWER_LEG', any: ['flexor hallucis longus'] },
];

const TENDON_WORDS = ['tendon', 'aponeurosis', 'ligament', 'retinaculum', 'fascia lata of', 'membrane'];

const toMeshId = (name) => name.replace(/\s+/g, '_');

function matches(meshName, def) {
  const n = meshName.toLowerCase();
  if (!def.any.some((p) => n.includes(p))) return false;
  if (def.not?.some((p) => n.includes(p))) return false;
  return true;
}

function sideOf(meshName) {
  const n = meshName.toLowerCase();
  const hasLeft = /\bleft\b/.test(n);
  const hasRight = /\bright\b/.test(n);
  if (hasLeft && !hasRight) return 'LEFT';
  if (hasRight && !hasLeft) return 'RIGHT';
  return 'MIDLINE';
}

const mappingPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_MAPPING;
const meshes = JSON.parse(await readFile(mappingPath, 'utf8'));

const entries = {};
const unmatched = [];

for (const def of DEFINITIONS) {
  const hits = meshes.filter(
    (m) => matches(m.name, def) && !TENDON_WORDS.some((w) => m.name.toLowerCase().includes(w)),
  );
  if (hits.length === 0) {
    unmatched.push(def.name);
    continue;
  }

  const sided = def.sided !== false;
  const buckets = sided
    ? { LEFT: hits.filter((m) => sideOf(m.name) === 'LEFT'), RIGHT: hits.filter((m) => sideOf(m.name) === 'RIGHT') }
    : { MIDLINE: hits };

  for (const [side, group] of Object.entries(buckets)) {
    if (group.length === 0) continue;
    const key = side === 'MIDLINE' ? def.name : `${side === 'LEFT' ? 'Left' : 'Right'} ${def.name}`;
    const meshNames = group.map((m) => toMeshId(m.name)).sort();
    entries[key] = {
      bodyExplorerId: meshNames.length === 1 ? meshNames[0] : '',
      bodyExplorerMeshNames: meshNames,
      side,
      group: def.group,
      fmaIds: group.map((m) => m.fmaId).filter(Boolean).sort(),
    };
  }
}

const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
await writeFile(OUTPUT, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

console.log(`source     : ${mappingPath}`);
console.log(`output     : ${OUTPUT}`);
console.log(`entries    : ${Object.keys(sorted).length}`);
console.log(`single-mesh: ${Object.values(sorted).filter((e) => e.bodyExplorerId !== '').length}`);
console.log(`multi-mesh : ${Object.values(sorted).filter((e) => e.bodyExplorerId === '').length}`);
if (unmatched.length > 0) console.log(`UNMATCHED  : ${unmatched.join(', ')}`);
