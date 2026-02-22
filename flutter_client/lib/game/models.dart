class PlayerState {
  PlayerState({
    required this.id,
    required this.displayName,
    required this.x,
    required this.y,
    required this.vx,
    required this.vy,
    required this.size,
    required this.totalAdoptions,
    required this.petsInside,
    required this.speedBoostUntil,
    required this.inputSeq,
    this.allies = const <String>[],
    this.eliminated = false,
    this.grounded = false,
    this.portCharges = 0,
    this.shelterPortCharges = 0,
    this.shelterColor,
    this.money = 0,
    this.shelterId,
    this.vanSpeedUpgrade = false,
    this.vanLure = false,
    this.team,
  });

  final String id;
  final String displayName;
  final double x;
  final double y;
  final double vx;
  final double vy;
  final double size;
  final int totalAdoptions;
  final List<String> petsInside;
  final int speedBoostUntil;
  final int inputSeq;
  final List<String> allies;
  final bool eliminated;
  final bool grounded;
  final int portCharges;
  final int shelterPortCharges;
  final String? shelterColor;
  final int money;
  final String? shelterId;
  final bool vanSpeedUpgrade;
  final bool vanLure;
  final String? team;
}

class PetState {
  PetState({
    required this.id,
    required this.x,
    required this.y,
    required this.vx,
    required this.vy,
    this.insideShelterId,
    this.petType = 0,
  });

  final String id;
  final double x;
  final double y;
  final double vx;
  final double vy;
  final String? insideShelterId;
  final int petType;
}

class AdoptionZoneState {
  AdoptionZoneState({
    required this.id,
    required this.x,
    required this.y,
    required this.radius,
  });

  final String id;
  final double x;
  final double y;
  final double radius;
}

class PickupState {
  PickupState({
    required this.id,
    required this.x,
    required this.y,
    required this.type,
    this.level,
  });

  final String id;
  final double x;
  final double y;
  final int type;
  final int? level;
}

class ShelterState {
  ShelterState({
    required this.id,
    required this.ownerId,
    required this.x,
    required this.y,
    required this.hasAdoptionCenter,
    required this.hasGravity,
    required this.hasAdvertising,
    required this.petsInside,
    required this.size,
    required this.totalAdoptions,
    required this.tier,
  });

  final String id;
  final String ownerId;
  final double x;
  final double y;
  final bool hasAdoptionCenter;
  final bool hasGravity;
  final bool hasAdvertising;
  final List<String> petsInside;
  final double size;
  final int totalAdoptions;
  final int tier;
}

class BreederShelterState {
  BreederShelterState({
    required this.id,
    required this.x,
    required this.y,
    required this.level,
    required this.size,
    this.millCount,
  });

  final String id;
  final double x;
  final double y;
  final int level;
  final double size;
  final int? millCount;
}

class AdoptionEventState {
  AdoptionEventState({
    required this.id,
    required this.type,
    required this.x,
    required this.y,
    required this.radius,
    required this.startTick,
    required this.durationTicks,
    required this.totalNeeded,
    required this.totalRescued,
  });

  final String id;
  final String type;
  final double x;
  final double y;
  final int radius;
  final int startTick;
  final int durationTicks;
  final int totalNeeded;
  final int totalRescued;
}

class BossMill {
  BossMill({
    required this.id,
    required this.petType,
    required this.petCount,
    required this.recipe,
    required this.purchased,
    required this.completed,
    required this.x,
    required this.y,
  });

  final int id;
  final int petType;
  final int petCount;
  final Map<String, int> recipe;
  final Map<String, int> purchased;
  final bool completed;
  final double x;
  final double y;
}

class BossModeState {
  BossModeState({
    required this.active,
    required this.startTick,
    required this.timeLimit,
    required this.mills,
    required this.tycoonX,
    required this.tycoonY,
    required this.tycoonTargetMill,
    required this.millsCleared,
    required this.mallX,
    required this.mallY,
    required this.playerAtMill,
    this.rebuildingMill,
  });

  final bool active;
  final int startTick;
  final int timeLimit;
  final List<BossMill> mills;
  final double tycoonX;
  final double tycoonY;
  final int tycoonTargetMill;
  final int millsCleared;
  final double mallX;
  final double mallY;
  final int playerAtMill;
  final int? rebuildingMill;
}

class GameSnapshot {
  GameSnapshot({
    required this.tick,
    required this.matchEndAt,
    required this.players,
    required this.pets,
    required this.adoptionZones,
    required this.pickups,
    this.matchEndedEarly = false,
    this.winnerId,
    this.strayLoss = false,
    this.totalMatchAdoptions = 0,
    this.scarcityLevel,
    this.matchDurationMs = 0,
    this.totalOutdoorStrays = 0,
    this.shelters = const <ShelterState>[],
    this.breederShelters = const <BreederShelterState>[],
    this.adoptionEvents = const <AdoptionEventState>[],
    this.bossMode,
    this.teamScores,
    this.winningTeam,
  });

  final int tick;
  final int matchEndAt;
  final bool matchEndedEarly;
  final String? winnerId;
  final bool strayLoss;
  final int totalMatchAdoptions;
  final int? scarcityLevel;
  final int matchDurationMs;
  final int totalOutdoorStrays;
  final List<PlayerState> players;
  final List<PetState> pets;
  final List<AdoptionZoneState> adoptionZones;
  final List<PickupState> pickups;
  final List<ShelterState> shelters;
  final List<BreederShelterState> breederShelters;
  final List<AdoptionEventState> adoptionEvents;
  final BossModeState? bossMode;
  final Map<String, int>? teamScores;
  final String? winningTeam;
}
