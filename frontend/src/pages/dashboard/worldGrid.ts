/**
 * [Gate Footprints2] 旅の足あとの世界地図の陸の升目(経度・緯度 3° ごと。北緯 81° から南緯 57° まで。南極は除く)。
 *
 * 出どころ: Natural Earth 1:50m の陸(パブリックドメイン)を world-atlas 2.0.2(ISC)の TopoJSON から、開発の時に 1 回だけ
 * 升目へ直した(升目の中の 5 点のうち 2 点以上が陸、または中心が陸)。アプリは地図のデータを外から読まない。
 * 文字: . 海 / N 北米 / S 南米 / E ヨーロッパ / F アフリカ / A アジア / J 日本 / O オセアニア(地域の色分けだけに使う略図)
 */
export const WORLD_STEP = 3;
export const WORLD_TOP = 81;
export const WORLD_ROWS: readonly string[] = [
  "............................NNNNNNNNNNNNNNNNNNNNNNNNNN..........EE.EE......................AA.A.........................",
  ".....................NNNNNN.NN.NNN...NNNNNNNNNNNNNNNNN...........E..............A.A.......AAAAAAAA.......AAA............",
  "..................NNNNN.N.NNNNN.NN.......NNNNNNNNNNNN.........................E....A.A.AAAAAAAAAAAAAAAA....A............",
  "......NNNNNNN..NNN.N.NNNNN..N.NNNNNNN....NNNNNNNNNNN...............EEE..........A.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.A..AA.",
  "NNN..NNNNNNNNNNNNNNNNNNNNNNNNNNNN.NNNNN...NNNNNNNN...............EEEEEEEEE.EEEEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "..N..NNNNNNNNNNNNNNNNNNNNNNNNNNNN.N.NNN....NNNN......NN........EEEE.EEEEEEEEEEEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ".....NNNNNNNNNNNNNNNNNNNNNNNN.....NN.N......NN................EEEE.EEEEEEEEEEEEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.",
  "......NNN.....NNNNNNNNNNNNNNN.....NNNNN...................E...EEEE.EEEEEEEEEEEEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA....AA.....",
  "...............NNNNNNNNNNNNNNNNN..NNNNNNN.................E....EEE.EEEEEEEEEEEEEAAAAAAAAAAAAAAAAAAAAAAAAAA......AA......",
  ".................NNNNNNNNNNNNNNNNNNNNNNNN...............EE.EE.EEEEEEEEEEEEEEEEEEAAAAAAAAAAAAAAAAAAAAAAAAAAAA....A.......",
  "..................NNNNNNNNNNNNNNNNNNNNNN.N................EEEEEEEEEEEEEEEEEEEEEEAAAAAAAAAAAAAAAAAAAAAAAAAAAA............",
  "..................NNNNNNNNNNNNNNNNNNNNN....................EEEEEEEEEEEEEEEEEEEEEAAAAAAAAAAAAAAAAAAAAAAAAAA..............",
  "..................NNNNNNNNNNNNNNNNNNN....................EEEEEEEEEEEEE...EEE.EEEAAAAAAAAAAAAAAAAAAAAAAAJJ..J............",
  "..................NNNNNNNNNNNNNNNNNN.....................EEEE....EEEEAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAA.................",
  "...................NNNNNNNNNNNNNNNN......................EEE.EE.E..E.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.A...J.............",
  "....................NNNNNNNNNNNNNN........................FFFFFF........AAAAAAAAAAAAAAAAAAAAAAAAAAAA..A.JJJ.............",
  ".....................NNNNNNNNNNNN........................FFFFFFFFFFFFFFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA..J................",
  ".....................NNNNNNN....N.......................FFFFFFFFFFFFFFFAAAAA.AAAAAAAAAAAAAAAAAAAAAAAA...................",
  "......................N.NNNN....N......................FFFFFFFFFFFFFFFFAAAAAA..AAAAAAAAAAAAAAAAAAAAA....................",
  ".........................NNN.....N....................FFFFFFFFFFFFFFFFFA.AAAAAAA...AAAAAAAAAAAAAAAA.....................",
  ".........................NNN.NN.....N.................FFFFFFFFFFFFFFFFFAAAAAAAA.....AAAAA..AAAAAA.......................",
  "...........................NNNNN......................FFFFFFFFFFFFFFFFFAA.AAAA......AAA....AAAAA....A...................",
  "..............................NN......................FFFFFFFFFFFFFFFFFAAAAA.........AA.....AAAAA.......................",
  "...............................N...SSSS................FFFFFFFFFFFFFFFFFFFFFF........AA........A........................",
  "..................................SSSSSS................FFFFFFFFFFFFFFFFFFFFF.........A......A.......A..................",
  "..................................SSSSSSSSS..............FFF..FFFFFFFFFFFFFF................AAA...AA....................",
  "..................................SSSSSSSSS....................FFFFFFFFFFFF..................AA.AAAAA.A.................",
  ".................................SSSSSSSSSSSS..................FFFFFFFFFFF...................AA.AAA.A.A.A...............",
  ".................................SSSSSSSSSSSSSSS................FFFFFFFFF.....................AA.........AAO............",
  ".................................SSSSSSSSSSSSSSSS...............FFFFFFFFF.......................AA........AOOO..........",
  "..................................SSSSSSSSSSSSSS................FFFFFFFFFF...................................O..........",
  "..O...............................SSSSSSSSSSSSS.................FFFFFFFFFF..F..........................OOO.O............",
  "...................................SSSSSSSSSSSS.................FFFFFFFFF..FF........................OOOOOOOO...........",
  "....................................SSSSSSSSSSS.................FFFFFFFF..FFF.......................OOOOOOOOO...........",
  "....................................SSSSSSSSSS...................FFFFFFF..FF......................OOOOOOOOOOOO..........",
  "....................................SSSSSSSS.....................FFFFFF...........................OOOOOOOOOOOOO.........",
  "....................................SSSSSSSS.....................FFFFFF...........................OOOOOOOOOOOOO.........",
  "....................................SSSSSSS.......................FFFF............................OOOOOOOOOOOOO.........",
  "....................................SSSSSS........................FFF..............................OO.....OOOO..........",
  "...................................SSSSSS..................................................................OOO........O.",
  "...................................SSSS...............................................................................O.",
  "...................................SSSS.............................................................................OO..",
  "...................................SSS..............................................................................O...",
  "...................................SS...................................................................................",
  "...................................SS...................................................................................",
  "....................................SS..................................................................................",
];
