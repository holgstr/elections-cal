const DE_STATE_FLAGS = {
  BW: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Flag_of_Baden-W%C3%BCrttemberg.svg/32px-Flag_of_Baden-W%C3%BCrttemberg.svg.png",
  BY: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Flag_of_Bavaria_%28lozengy%29.svg/32px-Flag_of_Bavaria_%28lozengy%29.svg.png",
  BE: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Flag_of_Berlin.svg/32px-Flag_of_Berlin.svg.png",
  BB: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Flag_of_Brandenburg.svg/32px-Flag_of_Brandenburg.svg.png",
  HB: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Flag_of_Bremen.svg/32px-Flag_of_Bremen.svg.png",
  HH: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Flag_of_Hamburg.svg/32px-Flag_of_Hamburg.svg.png",
  HE: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Flag_of_Hesse.svg/32px-Flag_of_Hesse.svg.png",
  MV: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Flag_of_Mecklenburg-Western_Pomerania.svg/32px-Flag_of_Mecklenburg-Western_Pomerania.svg.png",
  NI: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Flag_of_Lower_Saxony.svg/32px-Flag_of_Lower_Saxony.svg.png",
  NW: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Flag_of_North_Rhine-Westphalia.svg/32px-Flag_of_North_Rhine-Westphalia.svg.png",
  RP: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Flag_of_Rhineland-Palatinate.svg/32px-Flag_of_Rhineland-Palatinate.svg.png",
  SL: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Flag_of_Saarland.svg/32px-Flag_of_Saarland.svg.png",
  SN: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Flag_of_Saxony.svg/32px-Flag_of_Saxony.svg.png",
  ST: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Flag_of_Saxony-Anhalt_%28state%29.svg/32px-Flag_of_Saxony-Anhalt_%28state%29.svg.png",
  SH: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Flag_of_Schleswig-Holstein.svg/32px-Flag_of_Schleswig-Holstein.svg.png",
  TH: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Flag_of_Thuringia.svg/32px-Flag_of_Thuringia.svg.png",
};

export function flagUrl(election) {
  if (election.country_code === "US" && election.state_code) {
    return `https://flags.telco.dev/us/${election.state_code.toLowerCase()}/${election.state_code.toLowerCase()}_48x32.png`;
  }

  if (election.country_code === "DE" && election.state_code) {
    return DE_STATE_FLAGS[election.state_code] || countryFlagUrl(election.country_code);
  }

  return countryFlagUrl(election.country_code);
}

export function countryFlagUrl(countryCode) {
  return `https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`;
}

export function flagAlt(election) {
  if (election.state) {
    return `${election.state} flag`;
  }
  return `${election.country} flag`;
}
