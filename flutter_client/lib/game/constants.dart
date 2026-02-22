const int tickRate = 25;
const double tickMs = 1000 / tickRate;

const double mapWidth = 4800;
const double mapHeight = 4800;

const int inputLeft = 1 << 0;
const int inputRight = 1 << 1;
const int inputUp = 1 << 2;
const int inputDown = 1 << 3;
const int inputInteract = 1 << 4;

const int msgInput = 0x01;
const int msgSnapshot = 0x02;
