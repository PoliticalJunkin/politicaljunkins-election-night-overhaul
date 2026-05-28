/* Better Election Maps – better-maps/tooltip.js
   NBC Decision Desk refresh
   Adds: county trend arrows, PVI-based battleground badges, key race indicators. */

{
    const resultProxies = require("./proxies.js");
    const municipalityShiftData = require("./municipalityShiftData.js");
    const { getCandidateColour, stringifyColour } = require("./colours.js");

    const tooltipSettings = {
        locale: "en-US",
        percentDecimals: 2,
        pviBattlegroundThreshold: 5,
        tooCloseThreshold: 1,
        keyRaceThreshold: 5,
        countyTrendThreshold: 5
    };

    const tooltipDiv = document.createElement("div");
    tooltipDiv.setAttribute("style", "display: none;");
    tooltipDiv.setAttribute("id", "better-maps-tooltip");
    tooltipDiv.classList.add("nbc-tooltip-container");

    const tooltipComponents = {};


    const isShiftMunicipalityState = (stateId) => ["ma", "nh"].includes(String(stateId || "").toLowerCase());

    const getShiftMunicipalityId = (pathId) => String(pathId || "")
        .toLowerCase()
        .replace(/-state-path-live$/, "")
        .replace(/-state-path$/, "");

    const clampShare = (value) => Math.max(0.02, Math.min(0.98, value));

    const getMunicipalityTurnoutMultiplier = (electionType) => {
        if(electionType === "president") return 1;
        if(electionType === "governor" || electionType === "usSenate") return 0.64;
        return 0.72;
    };

    const getCandidatePartyKey = (cand) => {
        if(!cand) return "";
        if(cand.party === "I") return cand.caucus ? "I" + cand.caucus : "I";
        if(cand.party) return String(cand.party).charAt(0);
        if(cand.caucus) return String(cand.caucus).charAt(0);
        return "";
    };

    const getActualRaceParties = (electionType) => {
        const stateDistrict = resultProxies[electionType] ? resultProxies[electionType][activeMap] : null;
        if(!stateDistrict || !stateDistrict.cands) return [];
        const parties = [];
        stateDistrict.cands.forEach(cand => {
            const party = cand.party === "I" ? "I" : getCandidatePartyKey(cand).charAt(0);
            if(party && parties.indexOf(party) === -1) parties.push(party);
        });
        return parties;
    };

    const findRaceCandidate = (electionType, party) => {
        const stateDistrict = resultProxies[electionType] ? resultProxies[electionType][activeMap] : null;
        if(!stateDistrict || !stateDistrict.cands) return null;
        return stateDistrict.cands.filter(cand => {
            const candParty = cand.party === "I" ? "I" : cand.party;
            return candParty === party;
        })[0] || null;
    };

    const makeSyntheticCandidate = (electionType, party, votes) => {
        const base = findRaceCandidate(electionType, party);
        const fallbackName = party === "D" ? "Democratic Candidate" : (party === "R" ? "Republican Candidate" : "Independent Candidate");
        const cand = base ? Object.assign({}, base) : { name: fallbackName, party, caucus: party };
        cand.party = party;
        cand.caucus = cand.caucus || party;
        cand.votes = votes;
        cand.currentVotes = votes;
        return cand;
    };

    const getCountySwingSource = (electionType, live) => {
        try {
            const stateDistrict = resultProxies[electionType][activeMap];
            if(!stateDistrict || !stateDistrict.counties || stateDistrict.counties.length === 0) return null;

            let demVotes = 0, repVotes = 0, indVotes = 0, totalVotes = 0;
            stateDistrict.counties.forEach(county => {
                if(!county.cands) return;
                county.cands.forEach(cand => {
                    const v = live ? safeNum(cand.currentVotes, safeNum(cand.votes)) : safeNum(cand.votes);
                    const party = cand.party === "I" ? "I" : cand.party;
                    if(party === "D") demVotes += v;
                    else if(party === "R") repVotes += v;
                    else indVotes += v;
                    totalVotes += v;
                });
            });

            if(totalVotes <= 0) return null;
            const demShare = demVotes / totalVotes;
            return {
                demShare,
                swing: demShare - 0.50,
                totalVotes,
                reportingRatio: stateDistrict.totalVotes > 0
                    ? Math.max(0, Math.min(1, safeNum(stateDistrict.totalCurrVotes) / safeNum(stateDistrict.totalVotes)))
                    : 1
            };
        } catch(err) {
            return null;
        }
    };

    const getMunicipalitySyntheticDistrict = (muniId, electionType, live) => {
        const stateKey = String(activeMap || "").toUpperCase();
        const stateData = municipalityShiftData[stateKey];
        const meta = stateData ? stateData[muniId] : null;
        if(!meta) return undefined;

        const source = getCountySwingSource(electionType, live);
        const countySwing = source ? source.swing : 0;

        const demShare = clampShare(meta.demBaseline + countySwing);
        const actualParties = getActualRaceParties(electionType);
        const hasDemocrat = actualParties.indexOf("D") !== -1;
        const hasRepublican = actualParties.indexOf("R") !== -1;
        const hasIndependent = actualParties.indexOf("I") !== -1;
        const indShare = hasIndependent && hasRepublican ? 0.025 : 0;
        const repShare = hasRepublican ? clampShare(1 - demShare - indShare) : 0;
        const finalIndShare = hasIndependent ? Math.max(0, 1 - (hasDemocrat ? demShare : 0) - repShare) : 0;

        const turnout = Math.max(250, Math.floor(4200 * getMunicipalityTurnoutMultiplier(electionType) * (meta.turnoutWeight || 1)));
        const demVotes = hasDemocrat ? Math.floor(turnout * demShare) : 0;
        const repVotes = Math.floor(turnout * repShare);
        const indVotes = Math.floor(turnout * finalIndShare);
        const reportingRatio = (!live || !source) ? 1 : Math.max(0, Math.min(1, source.reportingRatio));
        const currentTurnout = Math.floor(turnout * reportingRatio);
        const demCurrentVotes = Math.floor(demVotes * reportingRatio);
        const repCurrentVotes = Math.floor(repVotes * reportingRatio);
        const indCurrentVotes = Math.max(0, currentTurnout - demCurrentVotes - repCurrentVotes);

        const cands = [];
        if(hasDemocrat) cands.push(makeSyntheticCandidate(electionType, "D", demVotes));
        if(hasRepublican) cands.push(makeSyntheticCandidate(electionType, "R", repVotes));
        if(hasIndependent) cands.push(makeSyntheticCandidate(electionType, "I", indVotes));
        cands.forEach(cand => {
            if(cand.party === "D") cand.currentVotes = demCurrentVotes;
            else if(cand.party === "R") cand.currentVotes = repCurrentVotes;
            else cand.currentVotes = indCurrentVotes;
        });

        return {
            name: meta.displayName || muniId,
            totalVotes: turnout,
            totalCurrVotes: currentTurnout,
            pW: !live || reportingRatio >= 1,
            cands
        };
    };


    const safeNum = (value, fallback = 0) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };

    const formatNumber = (num) => Math.round(safeNum(num)).toLocaleString(tooltipSettings.locale);

    const formatPercent = (num) => safeNum(num).toLocaleString(tooltipSettings.locale, {
        minimumFractionDigits: tooltipSettings.percentDecimals,
        maximumFractionDigits: tooltipSettings.percentDecimals
    });

    const getStateObj = (districtId) => {
        try { return Executive.data.states[districtId.toLowerCase()]; }
        catch(err) { return null; }
    };

    const sameDistrictName = (value, districtId, stateObj) => {
        if(value === undefined || value === null) return false;
        const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
        const stateName = stateObj && stateObj.name ? String(stateObj.name).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        const stateCode = String(districtId || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return normalized === stateName || normalized === stateCode;
    };


    const getSubdivisionLabel = (districtId) => {
        const id = String(districtId || activeMap || "").toLowerCase();
        if(id === "la") return "Parish";
        if(id === "ma" || id === "nh") return "Municipality";
        return "County";
    };

    const getPviInfo = (districtId) => {
        const state = getStateObj(districtId);
        if(!state) return { value: null, label: "PVI N/A", party: "" };

        const dem = safeNum(state.demPop);
        const rep = safeNum(state.repPop);
        const diff = (dem - rep) * 100;
        const abs = Math.abs(diff);
        let party = "EVEN";
        if(diff >= 0.5) party = "D";
        else if(diff <= -0.5) party = "R";

        const label = party === "EVEN" ? "PVI EVEN" : `${party}+${formatPercent(abs)}`;
        return { value: abs, label, party, raw: diff };
    };

    const candidateVotes = (cand, live) => safeNum(live ? cand.currentVotes : cand.votes);
    const districtVotes = (district, live) => safeNum(live ? district.totalCurrVotes : district.totalVotes);

    const sortedCandidates = (district, live) => {
        if(!district || !district.cands) return [];
        return district.cands.slice().sort((a, b) => candidateVotes(b, live) - candidateVotes(a, live));
    };

    const getRaceStats = (district, live) => {
        const cands = sortedCandidates(district, live);
        const total = districtVotes(district, live);
        const leader = cands[0] || null;
        const runnerUp = cands[1] || null;
        const leaderVotes = leader ? candidateVotes(leader, live) : 0;
        const runnerVotes = runnerUp ? candidateVotes(runnerUp, live) : 0;
        const marginVotes = leaderVotes - runnerVotes;
        const marginPct = total > 0 ? (marginVotes / total) * 100 : 0;
        const leaderShare = total > 0 ? (leaderVotes / total) * 100 : 0;
        return { cands, total, leader, runnerUp, leaderVotes, runnerVotes, marginVotes, marginPct, leaderShare };
    };

    const getPartyKey = (cand) => {
        if(!cand) return "";
        if(cand.party === "I") return "I" + (cand.caucus || "");
        if(cand.party) return String(cand.party).charAt(0);
        if(cand.caucus) return String(cand.caucus).charAt(0);
        return "";
    };

    const getArchiveElectionForType = (electionType) => {
        try {
            if(electionType === "president" && typeof presidentialArchive !== "undefined" && presidentialArchive.length > 0){
                return { archive: presidentialArchive, lastYear: presidentialArchive[0].year - 4 };
            }
            if(electionType === "usSenate" && typeof usSenateArchive !== "undefined" && usSenateArchive.length > 0){
                return { archive: usSenateArchive, lastYear: usSenateArchive[0].year - 6 };
            }
            if(electionType === "governor" && typeof allGovArchive !== "undefined" && allGovArchive.length > 0){
                return { archive: allGovArchive, lastYear: allGovArchive[0].year - 4 };
            }
        } catch(err) {}
        return null;
    };

    const isFlippedSeat = (electionType, districtId, district, live, countyView) => {
        if(countyView || !district || !district.cands) return false;
        if(!(district.pW === true || !live)) return false;

        const currentStats = getRaceStats(district, live);
        if(!currentStats.leader) return false;

        const archiveInfo = getArchiveElectionForType(electionType);
        if(!archiveInfo) return false;

        const stateObj = getStateObj(districtId);
        if(!stateObj) return false;

        const oldElection = archiveInfo.archive.filter(item => item.category === "general" && item.year === archiveInfo.lastYear)[0];
        if(!oldElection || !oldElection.elections) return false;

        const oldDistrict = oldElection.elections.filter(item => item.district === stateObj.name
            || sameDistrictName(item.district, districtId, stateObj)
            || sameDistrictName(item.state, districtId, stateObj)
            || sameDistrictName(item.id, districtId, stateObj)
            || sameDistrictName(item.stateId, districtId, stateObj))[0];
        if(!oldDistrict || !oldDistrict.cands) return false;

        const oldStats = getRaceStats(oldDistrict, false);
        if(!oldStats.leader) return false;

        return getPartyKey(oldStats.leader) !== getPartyKey(currentStats.leader);
    };

    const getCandidateLastName = (cand) => {
        if(!cand || !cand.name) return "Unknown";
        const parts = String(cand.name).trim().split(/\s+/);
        return parts.length > 1 ? parts[parts.length - 1] : parts[0];
    };

    const getCandidateAnimationKey = (cand) => {
        if(!cand) return "unknown";
        return `${getPartyKey(cand)}:${String(cand.name || "").toLowerCase()}`;
    };

    const getPartyLabel = (cand) => {
        if(!cand) return "";
        if(cand.party === "I") return cand.caucus ? `I-${cand.caucus}` : "I";
        return cand.party || cand.caucus || "";
    };

    const getPartyClass = (cand) => {
        const party = getPartyLabel(cand).charAt(0).toLowerCase();
        if(party === "d") return "party-d";
        if(party === "r") return "party-r";
        return "party-i";
    };

    const makeBadge = (text, className) => {
        const badge = document.createElement("span");
        badge.className = `bm-nbc-badge ${className || ""}`;
        badge.innerText = text;
        return badge;
    };

    const normalizeRuleText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const getNestedValue = (obj, keys) => {
        if(!obj) return undefined;
        for(let i = 0; i < keys.length; i++){
            const key = keys[i];
            if(Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
        }
        return undefined;
    };

    const settingEnabled = (value) => {
        if(value === true) return true;
        if(value === 1) return true;
        const text = normalizeRuleText(value);
        return text === "true" || text === "yes" || text === "enabled" || text === "active" || text === "on" || text === "rcv" || text === "rankedchoice";
    };

    const getStateRuleObjects = (districtId, district) => {
        const stateObj = getStateObj(districtId);
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const objects = [district, stateObj];
        try { if(Executive && Executive.data && Executive.data.states) objects.push(Executive.data.states[stateKey]); } catch(err) {}
        try { if(Executive && Executive.data && Executive.data.advOptions) objects.push(Executive.data.advOptions); } catch(err) {}
        try { if(typeof advOptions !== "undefined") objects.push(advOptions); } catch(err) {}
        try { if(typeof advancedOptions !== "undefined") objects.push(advancedOptions); } catch(err) {}
        try { if(typeof electionSettings !== "undefined") objects.push(electionSettings); } catch(err) {}
        return objects.filter(Boolean);
    };

    const objectTextHas = (obj, terms) => {
        if(!obj) return false;
        let text = "";
        try { text = normalizeRuleText(JSON.stringify(obj)); } catch(err) { text = normalizeRuleText(String(obj)); }
        return terms.some(term => text.indexOf(normalizeRuleText(term)) !== -1);
    };

    const objectHasEnabledRuleMarker = (obj, keyTerms, valueTerms, depth = 0) => {
        if(!obj || depth > 4) return false;
        if(typeof obj !== "object") return valueTerms.some(term => normalizeRuleText(obj).indexOf(normalizeRuleText(term)) !== -1);

        const keys = Object.keys(obj);
        for(let i = 0; i < keys.length; i++){
            const key = keys[i];
            const value = obj[key];
            const keyText = normalizeRuleText(key);
            const keyMatches = keyTerms.some(term => keyText.indexOf(normalizeRuleText(term)) !== -1);

            if(keyText.indexOf("norcv") !== -1 || keyText.indexOf("disablercv") !== -1 || keyText.indexOf("rcvdisabled") !== -1) continue;
            if(keyMatches && settingEnabled(value)) return true;
            if(keyMatches && typeof value === "string" && valueTerms.some(term => normalizeRuleText(value).indexOf(normalizeRuleText(term)) !== -1)) return true;
            if(typeof value === "object" && objectHasEnabledRuleMarker(value, keyTerms, valueTerms, depth + 1)) return true;
        }

        return false;
    };

    const getPrimaryAdvanceInfo = (districtId, district) => {
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const stateObj = getStateObj(districtId);
        const stateName = normalizeRuleText(stateObj ? stateObj.name : "");
        const objects = getStateRuleObjects(districtId, district);
        let topCount = null;
        let nonpartisan = false;

        objects.forEach(obj => {
            const count = getNestedValue(obj, ["topAdvance", "topAdvancers", "primaryAdvancers", "advanceCount", "numAdvance", "numAdvancers", "topPrimary"]);
            if(Number(count) === 2 || Number(count) === 4) topCount = Number(count);

            const format = getNestedValue(obj, ["primaryType", "primarySystem", "primaryFormat", "primaryElectionType", "primaryStyle"]);
            const text = normalizeRuleText(format);
            if(text.indexOf("toptwo") !== -1 || text.indexOf("top2") !== -1) topCount = 2;
            if(text.indexOf("topfour") !== -1 || text.indexOf("top4") !== -1) topCount = 4;
            if(text.indexOf("nonpartisan") !== -1 || text.indexOf("jungle") !== -1) nonpartisan = true;

            if(settingEnabled(getNestedValue(obj, ["nonpartisanPrimary", "junglePrimary", "openPrimaryAllCandidates"]))) nonpartisan = true;
            if(settingEnabled(getNestedValue(obj, ["topTwoPrimary", "top2Primary"]))) topCount = 2;
            if(settingEnabled(getNestedValue(obj, ["topFourPrimary", "top4Primary"]))) topCount = 4;
        });

        if(topCount === null && (stateKey === "ak" || stateName === "alaska")) topCount = 4;
        if(topCount === null && (stateKey === "ca" || stateKey === "wa" || stateName === "california" || stateName === "washington")) topCount = 2;
        if(topCount === 2 || topCount === 4) nonpartisan = true;

        return { topCount, nonpartisan };
    };

    const isRcvActiveForRace = (districtId, district) => {
        const objects = getStateRuleObjects(districtId, district);
        const stateObj = getStateObj(districtId);
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const stateName = normalizeRuleText(stateObj ? stateObj.name : "");
        let active = false;

        if(stateKey === "ak" || stateName === "alaska") active = true;
        objects.forEach(obj => {
            if(settingEnabled(getNestedValue(obj, ["rcv", "RCV", "rankedChoice", "rankedChoiceVoting", "instantRunoff", "useRCV", "rcvActive"]))) active = true;
            if(objectHasEnabledRuleMarker(obj, ["rcv", "ranked", "instantRunoff"], ["rcv", "rankedChoice", "ranked choice", "instantRunoff"])) active = true;
        });

        return active;
    };

    const isRcvUsedInGeneral = (districtId, district, live) => {
        if(!district || !isRcvActiveForRace(districtId, district)) return false;
        if(district.pW === true || !live){
            if(!hasMajorityWinner(district, live)) return true;
        }

        const objects = getStateRuleObjects(districtId, district);
        return objects.some(obj => objectHasEnabledRuleMarker(obj, ["rcvused", "usedrcv", "rankedchoiceused", "instantRunoffUsed"], ["used", "true", "active"]));
    };

    const isRunoffThresholdState = (districtId) => {
        const stateObj = getStateObj(districtId);
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const stateName = normalizeRuleText(stateObj ? stateObj.name : "");
        return stateKey === "ga" || stateKey === "la" || stateName === "georgia" || stateName === "louisiana";
    };

    const hasMajorityWinner = (district, live) => {
        const stats = getRaceStats(district, live);
        if(!stats || !stats.leader || stats.total <= 0) return false;
        return (candidateVotes(stats.leader, live) / stats.total) > 0.5;
    };

    const getElectionRuleIndicators = (electionType, districtId, district, live, countyView, primary) => {
        if(countyView) return [];
        const indicators = [];

        if(primary){
            const primaryInfo = getPrimaryAdvanceInfo(districtId, district);
            if(primaryInfo.topCount === 2) indicators.push({ text: "TOP TWO ADVANCE", className: "badge-election-rule" });
            if(primaryInfo.topCount === 4) indicators.push({ text: "TOP FOUR ADVANCE", className: "badge-election-rule" });
            if(primaryInfo.nonpartisan) indicators.push({ text: "NONPARTISAN PRIMARY", className: "badge-election-rule" });
            return indicators;
        }

        const rcvActive = isRcvActiveForRace(districtId, district);
        if(!rcvActive) return indicators;

        if(isRunoffThresholdState(districtId)){
            indicators.push({ text: "50% TO AVOID RUNOFF", className: "badge-runoff-rule" });
            if((district.pW === true || !live) && !hasMajorityWinner(district, live)){
                indicators.push({ text: "RUNOFF", className: "badge-runoff" });
            }
        } else {
            if(isRcvUsedInGeneral(districtId, district, live)){
                indicators.push({ text: "RCV USED", className: "badge-rcv-used" });
            } else {
                indicators.push({ text: "RCV: 50% NEEDED", className: "badge-election-rule" });
            }
        }

        return indicators;
    };

    const clearNode = (node) => {
        while(node.firstChild) node.firstChild.remove();
    };

    const getRaceIndicators = (district, districtId, live, countyView) => {
        if(countyView) return [];
        const stats = getRaceStats(district, live);
        const indicators = [];
        const pvi = countyView ? null : getPviInfo(districtId);

        if(!countyView && pvi && pvi.value !== null && pvi.value < tooltipSettings.pviBattlegroundThreshold){
            indicators.push({ text: "BATTLEGROUND", className: "badge-battleground" });
        }

        if(stats.total > 0 && stats.marginPct < tooltipSettings.tooCloseThreshold && district.pW !== true){
            indicators.push({ text: "TOO CLOSE TO CALL", className: "badge-tctc" });
        } else if(stats.total > 0 && stats.marginPct < tooltipSettings.keyRaceThreshold){
            indicators.push({ text: "KEY RACE", className: "badge-key" });
        }

        if(district.pW === true || (!live && stats.leader)){
            indicators.push({ text: "PROJECTED WINNER", className: "badge-projected" });
        }

        return indicators;
    };

    const clamp = (num, min, max) => Math.max(min, Math.min(max, num));

    const firstFinite = (...values) => {
        for(const value of values){
            const n = Number(value);
            if(Number.isFinite(n)) return n;
        }
        return null;
    };

    const normalizeShare = (value) => {
        const n = Number(value);
        if(!Number.isFinite(n)) return null;
        return (Math.abs(n) <= 1) ? n * 100 : n;
    };

    const getPviRawFromObject = (obj) => {
        if(!obj) return null;

        const direct = firstFinite(obj.pvi, obj.PVI, obj.partisanLean, obj.partisan_lean, obj.lean);
        if(direct !== null) return direct;

        const demShare = normalizeShare(firstFinite(obj.demPop, obj.dem, obj.demShare, obj.democraticShare, obj.democratShare, obj.D));
        const repShare = normalizeShare(firstFinite(obj.repPop, obj.rep, obj.repShare, obj.republicanShare, obj.republicanShare, obj.R));

        if(demShare !== null && repShare !== null) return demShare - repShare;
        return null;
    };

    const getIndependentShareFromObject = (obj) => {
        if(!obj) return null;
        return normalizeShare(firstFinite(obj.indPop, obj.ind, obj.indShare, obj.independentShare, obj.I));
    };

    const getCountyPviInfo = (countyDistrict) => {
        const pviRaw = firstFinite(
            getPviRawFromObject(countyDistrict._countyElectData),
            getPviRawFromObject(countyDistrict._origCounty),
            getPviRawFromObject(countyDistrict._stateElectData),
            getPviRawFromObject(getStateObj(activeMap.toLowerCase()))
        );

        const indShare = firstFinite(
            getIndependentShareFromObject(countyDistrict._countyElectData),
            getIndependentShareFromObject(countyDistrict._origCounty),
            getIndependentShareFromObject(countyDistrict._stateElectData),
            getIndependentShareFromObject(getStateObj(activeMap.toLowerCase())),
            0
        );

        const raw = Number.isFinite(pviRaw) ? pviRaw : 0;
        return {
            raw,
            expectedD: clamp(50 + (raw / 2), 0, 100),
            expectedR: clamp(50 - (raw / 2), 0, 100),
            expectedI: clamp(indShare || 0, 0, 100)
        };
    };

    const getPartyShare = (district, live, partyCode) => {
        const total = districtVotes(district, live);
        if(total <= 0 || !district || !district.cands) return 0;

        const partyVotes = district.cands
            .filter(cand => getPartyLabel(cand).charAt(0).toUpperCase() === partyCode)
            .reduce((sum, cand) => sum + candidateVotes(cand, live), 0);

        return (partyVotes / total) * 100;
    };

    const getCountyTrendInfo = (countyDistrict, parentDistrict, live) => {
        if(!countyDistrict || !countyDistrict._countyView) return null;

        const threshold = tooltipSettings.countyTrendThreshold;
        const pvi = getCountyPviInfo(countyDistrict);

        const demShare = getPartyShare(countyDistrict, live, "D");
        const repShare = getPartyShare(countyDistrict, live, "R");
        const indShare = getPartyShare(countyDistrict, live, "I");

        const demDelta = demShare - pvi.expectedD;
        const repDelta = repShare - pvi.expectedR;
        const indDelta = indShare - pvi.expectedI;

        const possible = [];
        if(demDelta >= threshold) possible.push({ arrow: "←", label: "BLUE", delta: demDelta, className: "trend-blue" });
        if(repDelta >= threshold) possible.push({ arrow: "→", label: "RED", delta: repDelta, className: "trend-red" });
        if(indShare >= 30 && indDelta >= threshold) possible.push({ arrow: "▲", label: "GRAY", delta: indDelta, className: "trend-gray" });

        if(possible.length === 0) return null;
        possible.sort((a, b) => b.delta - a.delta);
        return possible[0];
    };

    const appendMeta = (electionType, district, districtId, live, countyView, parentDistrict) => {
        clearNode(tooltipComponents.meta);

        const stats = getRaceStats(district, live);
        const metaLine = document.createElement("div");
        metaLine.className = "bm-nbc-meta-line";

        if(!countyView){
            const pvi = getPviInfo(districtId);
            const pviNode = document.createElement("span");
            pviNode.className = `bm-nbc-pvi pvi-${(pvi.party || "even").toLowerCase()}`;
            pviNode.innerText = pvi.label;
            metaLine.appendChild(pviNode);
        }

        if(countyView){
            const localityNode = document.createElement("span");
            localityNode.className = "bm-nbc-margin";
            localityNode.innerText = getSubdivisionLabel(activeMap).toUpperCase();
            metaLine.appendChild(localityNode);
        }

        if(stats.total > 0){
            const marginNode = document.createElement("span");
            marginNode.className = "bm-nbc-margin";
            marginNode.innerText = `Margin: ${formatNumber(stats.marginVotes)} (${formatPercent(stats.marginPct)}%)`;
            metaLine.appendChild(marginNode);
        }

        tooltipComponents.meta.appendChild(metaLine);

        const indicatorRow = document.createElement("div");
        indicatorRow.className = "bm-nbc-indicators";
        if(district._betterMapsFlipped === true && !countyView){
            indicatorRow.appendChild(makeBadge("FLIPPED", "badge-flipped"));
        }
        getElectionRuleIndicators(electionType, districtId, district, live, countyView, false).forEach(ind => {
            indicatorRow.appendChild(makeBadge(ind.text, ind.className));
        });
        getRaceIndicators(district, districtId, live, countyView).forEach(ind => {
            indicatorRow.appendChild(makeBadge(ind.text, ind.className));
        });
        if(indicatorRow.children.length > 0) tooltipComponents.meta.appendChild(indicatorRow);
    };

    const appendPrimaryRuleMeta = (electionType, district, districtId, live, countyView) => {
        clearNode(tooltipComponents.meta);
        const indicatorRow = document.createElement("div");
        indicatorRow.className = "bm-nbc-indicators";
        getElectionRuleIndicators(electionType, districtId, district, live, countyView, true).forEach(ind => {
            indicatorRow.appendChild(makeBadge(ind.text, ind.className));
        });
        if(indicatorRow.children.length > 0) tooltipComponents.meta.appendChild(indicatorRow);
    };

    const createTooltipEntry = (cand, district, live, winner) => {
        const row = document.createElement("div");
        row.className = `bm-nbc-row ${cand === winner ? "is-winner" : ""}`;
        row.setAttribute("data-candidate-key", getCandidateAnimationKey(cand));

        const party = document.createElement("div");
        party.className = `bm-nbc-party ${getPartyClass(cand)}`;
        party.innerText = getPartyLabel(cand).charAt(0) || "?";
        row.appendChild(party);

        const name = document.createElement("div");
        name.className = "bm-nbc-name";
        name.innerText = getCandidateLastName(cand);
        if(cand.incumbent === true){
            const inc = document.createElement("span");
            inc.className = "bm-nbc-incumbent";
            inc.innerText = "INC";
            name.appendChild(inc);
        }
        row.appendChild(name);

        const votes = candidateVotes(cand, live);
        const total = districtVotes(district, live);
        const pct = total > 0 ? (votes / total) * 100 : 0;

        const voteNode = document.createElement("div");
        voteNode.className = "bm-nbc-votes";
        voteNode.innerText = formatNumber(votes);
        row.appendChild(voteNode);

        const pctWrap = document.createElement("div");
        pctWrap.className = "bm-nbc-pct-wrap";
        const pctNode = document.createElement("div");
        pctNode.className = "bm-nbc-pct";
        pctNode.innerText = `${formatPercent(pct)}%`;
        pctWrap.appendChild(pctNode);

        const barTrack = document.createElement("div");
        barTrack.className = "bm-nbc-bar-track";
        const bar = document.createElement("div");
        bar.className = "bm-nbc-bar";
        bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        try { bar.style.backgroundColor = stringifyColour(getCandidateColour(cand)); } catch(err) {}
        barTrack.appendChild(bar);
        pctWrap.appendChild(barTrack);
        row.appendChild(pctWrap);

        if(cand === winner){
            const check = document.createElement("span");
            check.className = "bm-nbc-check";
            check.innerText = "✔";
            name.appendChild(check);
        }

        return row;
    };

    const captureCandidateRowPositions = () => {
        const positions = {};
        if(!tooltipComponents.entries) return positions;
        Array.from(tooltipComponents.entries.children).forEach((row, index) => {
            if(!row.getAttribute) return;
            const key = row.getAttribute("data-candidate-key");
            if(!key) return;
            positions[key] = {
                top: row.getBoundingClientRect().top,
                index
            };
        });
        return positions;
    };

    const animateCandidateRows = (previousPositions) => {
        if(!previousPositions || !tooltipComponents.entries) return;
        Array.from(tooltipComponents.entries.children).forEach((row, index) => {
            if(!row.getAttribute) return;
            const key = row.getAttribute("data-candidate-key");
            if(!key || !previousPositions[key]) return;

            const oldTop = previousPositions[key].top;
            const newTop = row.getBoundingClientRect().top;
            const deltaY = oldTop - newTop;
            if(Math.abs(deltaY) < 1) return;

            if(previousPositions[key].index > index) row.classList.add("is-gaining-position");
            row.style.transform = `translateY(${deltaY}px)`;
            row.style.transition = "none";
            row.getBoundingClientRect();
            requestAnimationFrame(() => {
                row.style.transition = "transform 520ms cubic-bezier(.16,.84,.24,1), background-color 360ms ease, box-shadow 360ms ease";
                row.style.transform = "translateY(0)";
            });
        });
    };

    const createCandidateTable = (district, live, primary) => {
        const stats = getRaceStats(district, live);
        const winner = (district._countyView === true) ? null : ((district.pW === true || !live) ? stats.leader : null);
        stats.cands.forEach(candidate => tooltipComponents.entries.appendChild(createTooltipEntry(candidate, district, live, winner)));
    };

    const buildPartyPrimaryBlock = (label, className, cands, live) => {
        if(!cands || cands.length === 0) return;
        const header = document.createElement("div");
        header.className = `bm-nbc-primary-header ${className}`;
        header.innerText = label;
        tooltipComponents.entries.appendChild(header);

        const total = cands.reduce((sum, c) => sum + candidateVotes(c, live), 0);
        const fakeDistrict = { totalVotes: total, totalCurrVotes: total, cands, pW: false };
        createCandidateTable(fakeDistrict, live, true);
    };

    const getHouseWinnerParty = (district, live) => {
        if(!district || !district.cands || district.cands.length === 0) return null;
        const cands = district.cands.slice().sort((a, b) => {
            const av = safeNum(live ? a.currentVotes : a.votes);
            const bv = safeNum(live ? b.currentVotes : b.votes);
            return bv - av;
        });
        const winner = cands[0];
        if(!winner) return null;
        if(winner.party === "I") return "I";
        return getPartyKey(winner).charAt(0);
    };

    const getHouseIncumbentParty = (district) => {
        if(!district || !district.cands) return null;
        const incumbent = district.cands.filter(cand => cand.incumbent === true)[0];
        if(!incumbent) return null;
        if(incumbent.party === "I") return "I";
        return getPartyKey(incumbent).charAt(0);
    };

    const getHouseSeatSummary = (districts, live, calledOnly) => {
        const summary = {
            seats: { D: 0, R: 0, I: 0 },
            flips: { D: 0, R: 0, I: 0 },
            totalFlips: 0,
            totalSeats: 0
        };

        districts.forEach(district => {
            if(calledOnly && district.pW !== true) return;
            const winnerParty = getHouseWinnerParty(district, live);
            if(!winnerParty) return;

            if(summary.seats[winnerParty] === undefined) summary.seats.I++;
            else summary.seats[winnerParty]++;
            summary.totalSeats++;

            const incumbentParty = getHouseIncumbentParty(district);
            if(incumbentParty && incumbentParty !== winnerParty){
                if(summary.flips[winnerParty] === undefined) summary.flips.I++;
                else summary.flips[winnerParty]++;
                summary.totalFlips++;
            }
        });

        return summary;
    };

    const appendHouseMetricBadge = (text, className) => {
        const badge = document.createElement("span");
        badge.className = `bm-nbc-badge ${className || ""}`;
        badge.innerText = text;
        return badge;
    };

    const appendHouseComposition = (houseState, live) => {
        const districts = houseState && houseState.districts ? houseState.districts : [];
        const called = { D: 0, R: 0, I: 0 };
        const leading = { D: 0, R: 0, I: 0 };

        districts.forEach(district => {
            const party = getHouseWinnerParty(district, live);
            if(!party) return;
            if(leading[party] === undefined) leading.I++;
            else leading[party]++;

            if(district.pW === true){
                if(called[party] === undefined) called.I++;
                else called[party]++;
            }
        });

        const totalCalled = called.D + called.R + called.I;
        tooltipComponents.reporting.innerText = `${totalCalled}/${districts.length} SEATS CALLED`;
        tooltipComponents.reporting.style.display = "block";

        const metaLine = document.createElement("div");
        metaLine.className = "bm-nbc-meta-line";
        const seatNode = document.createElement("span");
        seatNode.className = "bm-nbc-margin";
        seatNode.innerText = "U.S. HOUSE DELEGATION";
        metaLine.appendChild(seatNode);
        tooltipComponents.meta.appendChild(metaLine);

        const calledSummary = getHouseSeatSummary(districts, live, true);
        const indicatorRow = document.createElement("div");
        indicatorRow.className = "bm-nbc-indicators";
        indicatorRow.appendChild(appendHouseMetricBadge(`FLIPS: ${calledSummary.totalFlips}`, "badge-flipped"));
        if(calledSummary.flips.D > 0) indicatorRow.appendChild(appendHouseMetricBadge(`D +${calledSummary.flips.D}`, "badge-house-flip-d"));
        if(calledSummary.flips.R > 0) indicatorRow.appendChild(appendHouseMetricBadge(`R +${calledSummary.flips.R}`, "badge-house-flip-r"));
        if(calledSummary.flips.I > 0) indicatorRow.appendChild(appendHouseMetricBadge(`I +${calledSummary.flips.I}`, "badge-house-flip-i"));
        tooltipComponents.meta.appendChild(indicatorRow);

        const rows = [
            { party: "D", name: "Democrats", seats: called.D, leading: leading.D },
            { party: "R", name: "Republicans", seats: called.R, leading: leading.R },
            { party: "I", name: "Independents", seats: called.I, leading: leading.I }
        ].filter(row => row.seats > 0 || row.leading > 0 || row.party !== "I");

        rows.forEach(rowInfo => {
            const row = document.createElement("div");
            row.className = "bm-nbc-row bm-house-row";
            row.setAttribute("data-candidate-key", `house:${rowInfo.party}`);

            const party = document.createElement("div");
            party.className = `bm-nbc-party party-${rowInfo.party.toLowerCase()}`;
            party.innerText = rowInfo.party;
            row.appendChild(party);

            const name = document.createElement("div");
            name.className = "bm-nbc-name";
            name.innerText = rowInfo.name;
            row.appendChild(name);

            const votes = document.createElement("div");
            votes.className = "bm-nbc-votes";
            votes.innerText = `${rowInfo.seats}`;
            row.appendChild(votes);

            const pctWrap = document.createElement("div");
            pctWrap.className = "bm-nbc-pct-wrap";
            const pctNode = document.createElement("div");
            pctNode.className = "bm-nbc-pct";
            pctNode.innerText = live ? `${rowInfo.leading} leading` : `${rowInfo.seats} won`;
            pctWrap.appendChild(pctNode);

            const barTrack = document.createElement("div");
            barTrack.className = "bm-nbc-bar-track";
            const bar = document.createElement("div");
            bar.className = "bm-nbc-bar";
            bar.style.width = districts.length > 0 ? `${Math.max(0, Math.min(100, (rowInfo.leading / districts.length) * 100))}%` : "0%";
            const colour = rowInfo.party === "D" ? { h: 210, s: 100, l: 45 } : (rowInfo.party === "R" ? { h: 359, s: 100, l: 48 } : { h: 272, s: 78, l: 48 });
            bar.style.backgroundColor = stringifyColour(colour);
            barTrack.appendChild(bar);
            pctWrap.appendChild(barTrack);
            row.appendChild(pctWrap);

            tooltipComponents.entries.appendChild(row);
        });
    };

    const getCountyDistrict = (actualStDistrict, districtId, live) => {
        const origCounty = actualStDistrict.counties.filter(candCounty => {
            const truncatedName = candCounty.name.substring(0, candCounty.name.lastIndexOf(" "));
            const replacedName = candCounty.name.toLowerCase().replace(/ /g, "_").replace(/\./g, "");
            const truncatedReplacedName = truncatedName.toLowerCase().replace(/ /g, "_").replace(/\./g, "");
            return (replacedName === districtId || truncatedReplacedName === districtId);
        })[0];
        if(!origCounty) return undefined;

        const stateElectData = allStElectData.filter(electData => (electData.id === activeMap))[0];
        let totalCurrVotes = 0;
        let totalVotes = 0;

        const countyElectData = stateElectData && stateElectData.counties
            ? stateElectData.counties.filter(candCountyData => (candCountyData.name === origCounty.name))[0]
            : null;

        const newCounty = {
            name: origCounty.name,
            _countyView: true,
            _origCounty: origCounty,
            _countyElectData: countyElectData,
            _stateElectData: stateElectData,
            cands: origCounty.cands.map(candObj => {
                const newCandObj = Object.assign({}, candObj);
                if(!live) {
                    newCandObj.currentVotes = newCandObj.votes;
                } else {
                    newCandObj.currentVotes = countyElectData ? (newCandObj.votes * candObj.updates[countyElectData.indx]) : 0;
                }
                totalCurrVotes += safeNum(newCandObj.currentVotes);
                totalVotes += safeNum(newCandObj.votes);
                return newCandObj;
            })
        };
        newCounty.totalCurrVotes = totalCurrVotes;
        newCounty.totalVotes = totalVotes;
        return newCounty;
    };

    const updateTooltip = (electionType, districtId, force, live, countyView) => {
        if(tooltipComponents.properties.visible === false) return;
        if(electionType === tooltipComponents.properties.electionType && districtId === tooltipComponents.properties.districtId && force !== true) return;

        tooltipComponents.properties.electionType = electionType;
        tooltipComponents.properties.districtId = districtId;

        let currentResults = resultProxies[electionType];
        let currentDistrict = currentResults[districtId];
        let parentDistrict = null;

        if(countyView){
            if(isShiftMunicipalityState(activeMap)){
                currentDistrict = getMunicipalitySyntheticDistrict(getShiftMunicipalityId(districtId), electionType, live);
                parentDistrict = currentDistrict;
            } else {
                parentDistrict = currentResults[activeMap];
                currentDistrict = parentDistrict ? getCountyDistrict(parentDistrict, districtId, live) : undefined;
            }
        }

        if(electionType === "president" && !live && currentDistrict === undefined){
            const stateObj = getStateObj(districtId);
            const filteredDemStates = presPrimaryDemArray.states.filter(stateObj2 => (stateObj2.name === stateObj.name));
            const filteredRepStates = presPrimaryRepArray.states.filter(stateObj2 => (stateObj2.name === stateObj.name));
            if(filteredDemStates.length !== 0){
                currentDistrict = {
                    dem: { cands: filteredDemStates[0].candidates.map(cand => { const c = Object.assign({}, cand); c.votes = c.totVotes; c.party = "D"; return c; }) },
                    rep: { cands: filteredRepStates[0].candidates.map(cand => { const c = Object.assign({}, cand); c.votes = c.totVotes; c.party = "R"; return c; }) }
                };
            }
        }

        const previousCandidateRows = captureCandidateRowPositions();
        clearNode(tooltipComponents.entries);
        clearNode(tooltipComponents.meta);
        tooltipComponents.noElection.setAttribute("style", "display: none;");
        tooltipComponents.notCounting.setAttribute("style", "display: none;");
        tooltipComponents.electors.setAttribute("style", "display: none;");

        tooltipComponents.title.innerText = countyView ? (currentDistrict ? currentDistrict.name : getSubdivisionLabel(activeMap)) : (getStateObj(districtId) ? getStateObj(districtId).name : String(districtId).toUpperCase());

        if(currentDistrict === undefined){
            tooltipComponents.reporting.innerText = "";
            tooltipComponents.noElection.removeAttribute("style");
            return;
        }

        if(electionType === "usHouse" && currentDistrict.districts !== undefined){
            appendHouseComposition(currentDistrict, live);
            return;
        }

        if(currentDistrict.cands === undefined){
            tooltipComponents.reporting.innerText = "PRIMARY RESULTS";
            appendPrimaryRuleMeta(electionType, currentDistrict, districtId, live, countyView);
            if(currentDistrict.dem && currentDistrict.dem.cands.length !== 0){
                buildPartyPrimaryBlock("DEMOCRATIC PRIMARY", "primary-dem", currentDistrict.dem.cands.map(c => Object.assign({party: "D"}, c)), live);
            }
            if(currentDistrict.rep && currentDistrict.rep.cands.length !== 0){
                buildPartyPrimaryBlock("REPUBLICAN PRIMARY", "primary-rep", currentDistrict.rep.cands.map(c => Object.assign({party: "R"}, c)), live);
            }
            return;
        }

        const totalVotes = districtVotes(currentDistrict, live);
        const percentReportedRaw = currentDistrict.totalVotes > 0 ? Math.round((safeNum(currentDistrict.totalCurrVotes) / safeNum(currentDistrict.totalVotes)) * 100) : 0;
        const percentReported = currentDistrict.pW === true ? 100 : Math.max(0, Math.min(99, percentReportedRaw));
        const localityLabel = getSubdivisionLabel(activeMap);

        if(!countyView && !live){
            tooltipComponents.reporting.innerText = "FINAL / PROJECTED";
            tooltipComponents.reporting.style.display = "block";
        } else if(countyView){
            if(currentDistrict.pW === true){
                tooltipComponents.reporting.innerText = "FINAL / PROJECTED";
            } else if(activeMap === "ma" || activeMap === "nh"){
                tooltipComponents.reporting.innerText = `${percentReported}% EST. REPORTING`;
            } else {
                tooltipComponents.reporting.innerText = isShiftMunicipalityState(activeMap) ? `${percentReported}% EST. REPORTING` : `${percentReported}% OF VOTE IN`;
            }
            tooltipComponents.reporting.style.display = "block";
        } else if(percentReported < 95){
            tooltipComponents.reporting.innerText = `EST. / REPORTED VOTE: ${percentReported}% IN`;
            tooltipComponents.reporting.style.display = "block";
        } else {
            tooltipComponents.reporting.innerText = "";
            tooltipComponents.reporting.style.display = "none";
        }

        if(electionType === "president" && !countyView && !(live && currentDistrict.totalCurrVotes === 0)){
            const stateObj = getStateObj(districtId);
            if(stateObj){
                tooltipComponents.electors.innerText = `${stateObj.electoralNum} Electoral Votes`;
                tooltipComponents.electors.removeAttribute("style");
            }
        }

        if(live && safeNum(currentDistrict.totalCurrVotes) === 0){
            tooltipComponents.notCounting.removeAttribute("style");
        } else {
            currentDistrict._betterMapsFlipped = isFlippedSeat(electionType, districtId, currentDistrict, live, countyView);
            appendMeta(electionType, currentDistrict, districtId, live, countyView, parentDistrict);
            createCandidateTable(currentDistrict, live, false);
            animateCandidateRows(previousCandidateRows);
        }
    };

    const createTooltip = () => {
        tooltipComponents.properties = { visible: false, targetDistrict: null, electionType: "", districtId: "" };

        tooltipComponents.network = document.createElement("div");
        tooltipComponents.network.setAttribute("id", "better-maps-tooltip-network");
        tooltipComponents.network.innerText = "DECISION DESK";
        tooltipDiv.appendChild(tooltipComponents.network);

        tooltipComponents.header = document.createElement("div");
        tooltipComponents.header.setAttribute("id", "better-maps-tooltip-header");
        tooltipDiv.appendChild(tooltipComponents.header);

        tooltipComponents.title = document.createElement("div");
        tooltipComponents.title.setAttribute("id", "better-maps-tooltip-title");
        tooltipComponents.header.appendChild(tooltipComponents.title);

        tooltipComponents.reporting = document.createElement("div");
        tooltipComponents.reporting.setAttribute("id", "better-maps-tooltip-reporting");
        tooltipComponents.header.appendChild(tooltipComponents.reporting);

        tooltipComponents.meta = document.createElement("div");
        tooltipComponents.meta.setAttribute("id", "better-maps-tooltip-meta");
        tooltipDiv.appendChild(tooltipComponents.meta);

        tooltipComponents.entries = document.createElement("div");
        tooltipComponents.entries.setAttribute("id", "better-maps-tooltip-entries");
        tooltipDiv.appendChild(tooltipComponents.entries);

        tooltipComponents.noElection = document.createElement("div");
        tooltipComponents.noElection.innerText = "No election data available.";
        tooltipComponents.noElection.setAttribute("id", "better-maps-tooltip-no-election");
        tooltipComponents.noElection.setAttribute("style", "display: none;");
        tooltipDiv.appendChild(tooltipComponents.noElection);

        tooltipComponents.notCounting = document.createElement("div");
        tooltipComponents.notCounting.innerText = "Waiting for results...";
        tooltipComponents.notCounting.setAttribute("id", "better-maps-tooltip-not-counted");
        tooltipComponents.notCounting.setAttribute("style", "display: none;");
        tooltipDiv.appendChild(tooltipComponents.notCounting);

        tooltipComponents.electors = document.createElement("div");
        tooltipComponents.electors.setAttribute("id", "better-maps-tooltip-electors");
        tooltipComponents.electors.setAttribute("style", "display: none;");
        tooltipDiv.appendChild(tooltipComponents.electors);

        document.body.appendChild(tooltipDiv);
    };

    module.exports = { tooltipDiv, tooltipComponents, updateTooltip, createTooltip };
}
