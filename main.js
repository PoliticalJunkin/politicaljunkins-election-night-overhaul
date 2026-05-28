/* Better Election Maps – better-maps/main.js
   UPDATED: Margin Buckets
   (<1, 1-5, 5-15, 15-30, 30-45, >45)
*/

{
    const path = require("path");
    const fs = require("fs");

    const d3 = require("./third-party/d3.v7.min.js");
    const resultProxies = require("./proxies.js");
    const municipalityShiftData = require("./municipalityShiftData.js");

    const {getCandidateColour, getPoliticianColour, stringifyColour} = require("./colours.js");
    const {tooltipDiv, tooltipComponents, updateTooltip, createTooltip} = require("./tooltip.js");

    const mod = {};

    const originalElectPageMap = Executive.functions.getOriginalFunction("electPageMap");
    const originalElectNightMap = Executive.functions.getOriginalFunction("electNightMap");

    const originalSummaryNationMap = Executive.functions.getOriginalFunction("summaryNationMap");

    let config = null;

    let onCountyMap = false;
    let lastMapElectionType = "none";

    let lastUpdateDataHook = null;
    let tooltipMotionFrame = null;
    let tooltipTargetX = 0;
    let tooltipTargetY = 0;

    const moveTooltipSmoothly = (event) => {
        tooltipTargetX = event.pageX + 15;
        tooltipTargetY = Math.min(event.pageY + 15, window.innerHeight - tooltipDiv.offsetHeight - 15);
        if(tooltipMotionFrame !== null) return;

        tooltipMotionFrame = requestAnimationFrame(() => {
            tooltipDiv.style.left = tooltipTargetX + "px";
            tooltipDiv.style.top = tooltipTargetY + "px";
            tooltipMotionFrame = null;
        });
    };

    /* --- SISTEMA DE ALERTAS DE PROJEÇÃO --- */
    const shownProjections = new Set();
    let alertContainer = null;

    const createAlertContainer = () => {
        if (!document.getElementById("projection-alert-container")) {
            alertContainer = document.createElement("div");
            alertContainer.setAttribute("id", "projection-alert-container");
            document.body.appendChild(alertContainer);
        }
    };

    const showProjectionAlert = (winnerName, partyColor, stateName, office) => {
        if (!alertContainer) createAlertContainer();

        const alertDiv = document.createElement("div");
        alertDiv.setAttribute("class", "projection-alert");
        alertDiv.style.backgroundColor = stringifyColour(partyColor);

        const iconDiv = document.createElement("div");
        iconDiv.setAttribute("class", "alert-check-icon");
        iconDiv.innerText = "✓";
        alertDiv.appendChild(iconDiv);

        const textSpan = document.createElement("span");
        textSpan.innerText = `${winnerName} wins ${stateName} ${office}`;
        alertDiv.appendChild(textSpan);

        alertContainer.appendChild(alertDiv);

        setTimeout(() => {
            alertDiv.style.animation = "alertFadeOut 0.5s ease forwards";
            setTimeout(() => {
                if (alertDiv.parentElement) alertDiv.remove();
            }, 500);
        }, 5000);
    };

    const checkAndShowProjections = (electionType) => {
        if (!resultProxies[electionType]) return;

        const allDistricts = Object.keys(resultProxies[electionType]);

        allDistricts.forEach(districtId => {
            const district = resultProxies[electionType][districtId];
            
            if (district && district.pW === true) {
                const cacheKey = `${electionType}-${districtId}`;

                if (!shownProjections.has(cacheKey)) {
                    const raceInfo = getRaceInfo(district, true);
                    const winner = raceInfo.finalWinner;
                    
                    if (winner) {
                        const winnerColor = getCandidateColour(winner);
                        const stateName = Executive.data.states[districtId].name;
                        
                        let officeName = "";
                        if (electionType === "president") officeName = ""; 
                        if (electionType === "usSenate") officeName = "(Senate)";
                        if (electionType === "governor") officeName = "(Governor)";

                        showProjectionAlert(winner.name.split(" ").pop(), winnerColor, stateName, officeName);
                        shownProjections.add(cacheKey);
                    }
                }
            }
        });
    };

    /* --- LÓGICA DE CORES (MARGEM) --- */

    /* Helper para definir a intensidade da cor baseada na MARGEM */
    const getMarginScaleFactor = (margin) => {
        // Tilt / Lean / Likely / Safe / Solid margin categories.
        // margin is decimal: 0.05 = 5%.
        if (margin >= 0.25) return "solid";  // 25%+
        if (margin >= 0.10) return "safe";   // 10-25%
        if (margin >= 0.05) return "likely"; // 5-9%
        if (margin >= 0.01) return "lean";   // 1-4%
        return "tilt";                       // under 1%
    };

    const getMarginBucketColour = (baseColour, margin) => {
        const bucket = getMarginScaleFactor(margin);

        // Dark NBC-style colors, but clearly stepped by margin.
        const palette = {
            tilt:   { s: 48,  l: 84 },
            lean:   { s: 64,  l: 76 },
            likely: { s: 82,  l: 62 },
            safe:   { s: 96,  l: 49 },
            solid:  { s: 100, l: 35 }
        };

        const step = palette[bucket];

        return stringifyColour({
            h: baseColour.h,
            s: step.s,
            l: step.l
        });
    };


    const isShiftMunicipalityState = (stateId) => ["ma", "nh"].includes(String(stateId || "").toLowerCase());

    const getShiftMunicipalityId = (pathId) => String(pathId || "")
        .toLowerCase()
        .replace(/-state-path-live$/, "")
        .replace(/-state-path$/, "");

    const clampShare = (value) => Math.max(0.02, Math.min(0.98, value));

    const safeNum = (value, fallback = 0) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };

    const getMunicipalityTurnoutMultiplier = (electionType) => {
        if(electionType === "president") return 1;
        if(electionType === "governor" || electionType === "usSenate") return 0.64;
        return 0.72;
    };

    const getCandidateVotes = (cand, live) => safeNum(live ? cand.currentVotes : cand.votes);

    const getPartyKey = (cand) => {
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
            const party = cand.party === "I" ? "I" : getPartyKey(cand).charAt(0);
            if(party && parties.indexOf(party) === -1) parties.push(party);
        });
        return parties;
    };

    const sameDistrictName = (value, stateId, stateObj) => {
        if(value === undefined || value === null) return false;
        const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
        const stateName = stateObj && stateObj.name ? String(stateObj.name).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        const stateCode = String(stateId || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return normalized === stateName || normalized === stateCode;
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

    const fitOutlineGroupToViewport = (svgMap, outlineGroup, origWidth, origHeight) => {
        if(!onCountyMap || !isShiftMunicipalityState(activeMap)) return false;
        if(!outlineGroup || typeof outlineGroup.getBBox !== "function") return false;

        let bbox = null;
        try {
            bbox = outlineGroup.getBBox();
        } catch(err) {
            return false;
        }

        if(!bbox || bbox.width <= 0 || bbox.height <= 0) return false;

        const padX = Math.max(bbox.width * 0.025, 2);
        const padY = Math.max(bbox.height * 0.025, 2);
        outlineGroup.removeAttribute("transform");
        svgMap.setAttribute("viewBox", `${bbox.x - padX} ${bbox.y - padY} ${bbox.width + (padX * 2)} ${bbox.height + (padY * 2)}`);
        svgMap.setAttribute("preserveAspectRatio", "xMidYMid meet");
        return true;
    };

    const getCountySwingSource = (electionType, live) => {
        try {
            const stateDistrict = resultProxies[electionType][activeMap];
            if(!stateDistrict || !stateDistrict.counties || stateDistrict.counties.length === 0) return null;

            // Use whole-state county aggregate as the source-of-truth swing.
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
            // baseline uses 50/50 neutral; municipalities keep their baseline and inherit this movement.
            const swing = demShare - 0.50;

            return {
                demShare,
                swing,
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
        if(!meta) return null;

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


    const getRaceInfo = (district, live) => {
        const sortedCands = district.cands.slice().sort((cand1, cand2) => {
            if(live) return cand2.currentVotes - cand1.currentVotes;
            return cand2.votes - cand1.votes;
        });

        const topVotes = live ? sortedCands[0].currentVotes : sortedCands[0].votes;
        const secondVotes = (sortedCands[1] !== undefined) ? (live ? sortedCands[1].currentVotes : sortedCands[1].votes) : 0;

        const info = {
            currentLeader: sortedCands[0],
            currentLead: topVotes - secondVotes,
            leaderVotes: topVotes,
            finalWinner: null
        };

        if(district.pW){
            const resortedCands = sortedCands.sort((cand1, cand2) => {
                return cand2.votes - cand1.votes;
            });
            info.finalWinner = resortedCands[0];
        } else {
            info.finalWinner = info.currentLeader;
        }

        return info;
    };

    const updateMap = (svgMap, resultColours, electionType, live, projected) => {
        svgMap.setAttribute("data-colours", JSON.stringify(resultColours));

        const resultKeys = Object.keys(resultColours);
        const raceInfoCache = {};

        /* Pre-calculate race info */
        if(!projected && electionType !== "usHouse" && electionType !== "usHousePol") {
            resultKeys.forEach(stateId => {
                const currentDistrict = resultProxies[electionType][stateId];

                if(currentDistrict !== undefined && currentDistrict.cands !== undefined) {
                    raceInfoCache[stateId] = getRaceInfo(currentDistrict, live);
                    
                    const totalVotes = live ? currentDistrict.totalCurrVotes : currentDistrict.totalVotes;
                    // Cálculo da Margem
                    const margin = totalVotes > 0 
                        ? raceInfoCache[stateId].currentLead / totalVotes 
                        : 0;

                    raceInfoCache[stateId].currentMargin = margin;
                }
            });
        }

        resultKeys.forEach(stateId => {
            const currentDistrict = resultProxies[electionType][stateId];

            if(currentDistrict !== undefined && (electionType === "usHouse" || electionType === "usHousePol" 
                || electionType === "governorPol" || electionType === "usSenatePol" 
                || currentDistrict.cands !== undefined)) {
                
                let raceInfo = null;
                let newColour = null;

                if(electionType === "usHouse" || electionType === "usHousePol") {
                    const leadParty = (currentDistrict.projectedDem > currentDistrict.projectedRep) ? "D" : "R";
                    const baseColour = config.partyColours[leadParty];

                    const totalProj = currentDistrict.projectedDem + currentDistrict.projectedRep;
                    const marginDiff = Math.abs(currentDistrict.projectedDem - currentDistrict.projectedRep);
                    
                    // Margin for House
                    const margin = totalProj > 0 ? (marginDiff / totalProj) : 0;

                    if(currentDistrict.projectedDem === currentDistrict.projectedRep && totalProj > 0) 
                        newColour = stringifyColour(config.partyColours.HouseTie);
                    else if (totalProj === 0) 
                        newColour = resultColours[stateId]; 
                    else {
                        newColour = getMarginBucketColour(baseColour, margin);
                    }
                } else if (electionType === "usSenatePol") {
                     if(currentDistrict.senior.extendedAttribs.party === currentDistrict.junior.extendedAttribs.party){
                        newColour = stringifyColour(getPoliticianColour(currentDistrict.senior));
                    } else {
                        const seniorAcronym = (currentDistrict.senior.extendedAttribs.party === "Independent")
                            ? ("I" + currentDistrict.senior.caucusParty.charAt(0))
                            : currentDistrict.senior.caucusParty.charAt(0);
                        const juniorAcronym = (currentDistrict.junior.extendedAttribs.party === "Independent")
                            ? ("I" + currentDistrict.junior.caucusParty.charAt(0))
                            : currentDistrict.junior.caucusParty.charAt(0);
                        newColour = `url(#${seniorAcronym}:${juniorAcronym})`;
                    }
                } else if (electionType === "governorPol") {
                    newColour = stringifyColour(getPoliticianColour(currentDistrict));
                } else if(projected) {
                    /* Projected Maps Logic */
                    raceInfo = getRaceInfo(currentDistrict, live);
                    
                    let isGain = false;
                    let lastElectionArray = null;
                    let lastElectionYear = null;

                    /* Safe loading of archives */
                    if(electionType === "usSenate") { 
                        if (typeof usSenateArchive !== 'undefined' && usSenateArchive.length > 0) {
                            lastElectionArray = usSenateArchive; 
                            lastElectionYear = lastElectionArray[0].year - 6; 
                        }
                    } else if(electionType === "governor") { 
                        if (typeof allGovArchive !== 'undefined' && allGovArchive.length > 0) {
                            lastElectionArray = allGovArchive; 
                            lastElectionYear = lastElectionArray[0].year - 4; 
                        }
                    } else if(electionType === "president") { 
                        if (typeof presidentialArchive !== 'undefined' && presidentialArchive.length > 0) {
                            lastElectionArray = presidentialArchive; 
                            lastElectionYear = lastElectionArray[0].year - 4; 
                        }
                    }

                    if(lastElectionYear !== null && lastElectionArray !== null && currentDistrict.pW === true){
                        const lastElections = lastElectionArray.filter(archiveArray => (archiveArray.category === "general" && archiveArray.year === lastElectionYear));
                        if(lastElections.length !== 0){
                            const lastElection = lastElections[0];
                            const stateObj = Executive.data.states[stateId.toLowerCase()];
                            const distFullName = stateObj.name;
                            const lastDistricts = lastElection.elections.filter(dist => dist.district === distFullName
                                || sameDistrictName(dist.district, stateId, stateObj)
                                || sameDistrictName(dist.state, stateId, stateObj)
                                || sameDistrictName(dist.id, stateId, stateObj)
                                || sameDistrictName(dist.stateId, stateId, stateObj));
                            if(lastDistricts.length !== 0){
                                const oldRaceInfo = getRaceInfo(lastDistricts[0], false);
                                if(oldRaceInfo.currentLeader.party !== raceInfo.currentLeader.party
                                    || oldRaceInfo.currentLeader.caucus !== raceInfo.currentLeader.caucus){
                                    isGain = true;
                                }
                            }
                        }
                    }

                    if (isGain) {
                        const fillId = getPartyKey(raceInfo.currentLeader) + ":gain";
                        newColour = `url(#${fillId})`;
                    } else {
                        if (currentDistrict.pW === true) {
                             newColour = stringifyColour(getCandidateColour(raceInfo.finalWinner));
                        } 
                        else if (!live && raceInfo.leaderVotes > 0) {
                             newColour = stringifyColour(getCandidateColour(raceInfo.currentLeader));
                        } else {
                             newColour = resultColours[stateId];
                        }
                    }

                } else {
                    /* General / Live Map Logic */
                    raceInfo = raceInfoCache[stateId];
                    if(raceInfo === undefined || raceInfo.leaderVotes === 0) {
                        newColour = resultColours[stateId];
                    } else {
                        const baseColour = getCandidateColour(raceInfo.currentLeader);
                        
                        newColour = getMarginBucketColour(baseColour, raceInfo.currentMargin);
                    }
                }

                d3.select("#" + stateId + "-state-path" + (live ? "-live" : ""))
                    .style("fill", newColour);
            } else d3.select("#" + stateId + "-state-path" + (live ? "-live" : ""))
                .style("fill", resultColours[stateId]);
        });
    };

    const updateCountyMap = (svgMap, electionType, live) => {
        /* COUNTY-SHIFT MUNICIPALITY MODE */
        if(isShiftMunicipalityState(activeMap)){
            const paths = svgMap.getElementsByClassName("better-maps-state-path");
            for(let i = 0; i < paths.length; i++){
                const pathElem = paths[i];
                pathElem.style.transition = "fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out";
                const muniId = getShiftMunicipalityId(pathElem.getAttribute("id"));
                const syntheticDistrict = getMunicipalitySyntheticDistrict(muniId, electionType, live);

                if(!syntheticDistrict){
                    pathElem.style.fill = "#202734";
                    continue;
                }

                const raceInfo = getRaceInfo(syntheticDistrict, live);
                const totalVotes = live ? syntheticDistrict.totalCurrVotes : syntheticDistrict.totalVotes;
                const margin = totalVotes > 0 ? raceInfo.currentLead / totalVotes : 0;
                const baseColour = getCandidateColour(raceInfo.currentLeader);

                pathElem.style.fill = getMarginBucketColour(baseColour, margin);
            }
            return;
        }
        const currentOrigCounties = resultProxies[electionType][activeMap].counties;
        const newCounties = [];
        const stateElectData = allStElectData.filter(electData => (electData.id === activeMap))[0];
        const raceInfoCache = {};

        /* Process Counties */
        currentOrigCounties.forEach(origCounty => {
            let totalCurrVotes = 0;
            let totalVotes = 0;
            let caucusNum = { D: 0, R: 0 };

            const newCounty = {
                name: origCounty.name,
                cands: origCounty.cands.map(candObj => {
                    const newCandObj = Object.assign({}, candObj);
                    newCandObj.caucusCandNum = caucusNum[candObj.caucus];
                    caucusNum[candObj.caucus]++;

                    if(!live){
                        newCandObj.currentVotes = newCandObj.votes;
                    } else {
                        const countyElectData = stateElectData.counties.filter(candCountyData => (candCountyData.name === origCounty.name))[0];
                        newCandObj.currentVotes = (newCandObj.votes * candObj.updates[countyElectData.indx]);
                    }
                    totalCurrVotes += newCandObj.currentVotes;
                    totalVotes += newCandObj.votes;
                    return newCandObj;
                })
            };

            newCounty.totalCurrVotes = totalCurrVotes;
            newCounty.totalVotes = totalVotes;
            newCounties.push(newCounty);

            raceInfoCache[newCounty.name] = getRaceInfo(newCounty, live);

            const totalForCalc = live ? totalCurrVotes : totalVotes;
            
            // Calculate Margin for County
            const margin = totalForCalc > 0 
                ? raceInfoCache[newCounty.name].currentLead / totalForCalc 
                : 0;

            raceInfoCache[newCounty.name].currentMargin = margin;
        });

        /* Apply Colors */
        newCounties.forEach(county => {
            const raceInfo = raceInfoCache[county.name];
            let baseColour = getCandidateColour(raceInfo.currentLeader);

            if(raceInfo.currentLeader.caucusCandNum !== 0){
                const colourIndex = (raceInfo.currentLeader.caucusCandNum - 1) % config.alternateCaucusCountyColours[raceInfo.currentLeader.caucus].length;
                baseColour = config.alternateCaucusCountyColours[raceInfo.currentLeader.caucus][colourIndex];
            }

            /* Apply the Margin Bucket Logic */
            const newColour = (raceInfo.leaderVotes > 0)
                ? getMarginBucketColour(baseColour, raceInfo.currentMargin)
                : stringifyColour({ h: baseColour.h, s: 35, l: 88 });

            const croppedCountyName = county.name.substring(0, county.name.lastIndexOf(" "));
            const replacedFullName = county.name.toLowerCase().replace(/ /g, "_").replace(/\./g, "");
            const replacedCroppedName = croppedCountyName.toLowerCase().replace(/ /g, "_").replace(/\./g, "");

            if(document.getElementById(replacedFullName + "-state-path" + (live ? "-live" : ""))){
                d3.select("#" + replacedFullName + "-state-path" + (live ? "-live" : ""))
                    .style("transition", "fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out")
                    .style("fill", newColour);
            } else d3.select("#" + replacedCroppedName + "-state-path" + (live ? "-live" : ""))
                .style("transition", "fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out")
                .style("fill", newColour);
        });
    };

    /* Standard Pattern Functions */
    const createHatchPattern = (backColour, foreColour) => {
        const mainPatternElem = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
        mainPatternElem.setAttribute("width", "10"); mainPatternElem.setAttribute("height", "10");
        mainPatternElem.setAttribute("patternTransform", "rotate(45 0 0)");
        mainPatternElem.setAttribute("patternUnits", "userSpaceOnUse");

        const backRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        backRect.setAttribute("x", "0"); backRect.setAttribute("y", "0");
        backRect.setAttribute("width", "10"); backRect.setAttribute("height", "10");
        backRect.setAttribute("fill", backColour);
        mainPatternElem.appendChild(backRect);

        const hatchLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        hatchLine.setAttribute("x1", "0"); hatchLine.setAttribute("y1", "0");
        hatchLine.setAttribute("x2", "0"); hatchLine.setAttribute("y2", "10");
        hatchLine.setAttribute("style", `stroke: ${foreColour}; stroke-width: 8;`);
        mainPatternElem.appendChild(hatchLine);
        return mainPatternElem;
    };

    const createPartyPattern = (party1, party2) => {
        const partyCol1 = (party1.charAt(0) === "I") ? (config.partyColours.I[party1.charAt(1)]) : (config.partyColours[party1.charAt(0)]);
        const partyCol2 = (party2.charAt(0) === "I") ? (config.partyColours.I[party2.charAt(1)]) : (config.partyColours[party2.charAt(0)]);
        const pattern = createHatchPattern(stringifyColour(partyCol1), stringifyColour(partyCol2));
        pattern.setAttribute("id", party1 + ":" + party2);
        return pattern;
    };

    const createGainPattern = (party) => {
        const partyCol = (party.charAt(0) === "I") ? (config.partyColours.I[party.charAt(1)] || config.partyColours.I.default) : (config.partyColours[party.charAt(0)]);
        const partyColDarker = Object.assign({}, partyCol);
        partyColDarker.l = Math.max(partyCol.l - 10, 0);
        const pattern = createHatchPattern(stringifyColour(partyCol), stringifyColour(partyColDarker));
        pattern.setAttribute("id", party + ":gain");
        return pattern;
    };

    const createCrossHatches = (svgElem) => {
        svgElem.appendChild(createPartyPattern("D", "R"));
        svgElem.appendChild(createPartyPattern("R", "D"));
        svgElem.appendChild(createPartyPattern("D", "ID"));
        svgElem.appendChild(createPartyPattern("D", "IR"));
        svgElem.appendChild(createPartyPattern("R", "ID"));
        svgElem.appendChild(createPartyPattern("R", "IR"));
        svgElem.appendChild(createPartyPattern("ID", "D"));
        svgElem.appendChild(createPartyPattern("ID", "R"));
        svgElem.appendChild(createPartyPattern("IR", "D"));
        svgElem.appendChild(createPartyPattern("IR", "R"));
        svgElem.appendChild(createPartyPattern("ID", "IR"));
        svgElem.appendChild(createPartyPattern("IR", "ID"));
        svgElem.appendChild(createGainPattern("D"));
        svgElem.appendChild(createGainPattern("R"));
        svgElem.appendChild(createGainPattern("I"));
        svgElem.appendChild(createGainPattern("ID"));
        svgElem.appendChild(createGainPattern("IR"));
    };

    const getCanvasDimension = (canvasElem, attrName, fallback) => {
        const attrValue = canvasElem.getAttribute(attrName);
        const parsedAttr = attrValue ? parseFloat(attrValue) : NaN;
        if(Number.isFinite(parsedAttr) && parsedAttr > 0) return parsedAttr;
        const propValue = canvasElem[attrName];
        const parsedProp = parseFloat(propValue);
        return Number.isFinite(parsedProp) && parsedProp > 0 ? parsedProp : fallback;
    };

    /* Rendering Functions */
    const renderMap = (canvasElem, resultColours, electionType, live, onClickPageFunc, projected) => {
        const container = canvasElem.parentElement;
        let svgMap = document.getElementById(electionType + "-map" + (live ? "-live" : ""));

        let isProjected = (projected === undefined) ? false : projected;
        if(document.getElementById(!live ? "ePageProjectB" : "eNightProjectB")){
            isProjected = document.getElementById(!live ? "ePageProjectB" : "eNightProjectB").getAttribute("class")
                === (!live ? "ePageProjectBActive" : "eNightProjectBActive");
        }

        if(lastUpdateDataHook !== null) {
            Executive.functions.deregisterPostHook("electNightUpdateData", lastUpdateDataHook);
            lastUpdateDataHook = null;
        }

        if(electionType !== lastMapElectionType) onCountyMap = false;
        lastMapElectionType = electionType;

        let mapPath = Executive.mods.getRelativePathPrefix() + path.sep + "data" + path.sep +
            ((electionType === "president") ? "presidential.svg" : "states.svg");

        if(onCountyMap){
            if(!resultProxies[electionType][activeMap]) onCountyMap = false;
            else if(!resultProxies[electionType][activeMap].cands) onCountyMap = false;
            else if(resultProxies[electionType][activeMap].totalCurrVotes !== undefined
                && resultProxies[electionType][activeMap].totalCurrVotes === 0) onCountyMap = false;
        }

        if(onCountyMap){
            const countyMapPath = Executive.mods.getRelativePathPrefix() + path.sep + "data" + path.sep + "counties" + path.sep +
                activeMap.toLowerCase() + ".svg";
            if(fs.existsSync(countyMapPath)) mapPath = countyMapPath;
            else onCountyMap = false;
        }

        if(onCountyMap){
            const projectButton = document.getElementById(live ? "eNightProjectB" : "ePageProjectB");
            const marginButton = document.getElementById(live ? "eNightMarginB" : "ePageMarginB");
            if(projectButton && marginButton){
                projectButton.setAttribute("style", "display: none;");
                marginButton.setAttribute("style", "display: none;");
            }
            const returnButton = document.createElement("button");
            returnButton.setAttribute("id", projected ? "ePageReturnB2" : (live ? "eNightReturnB" : "ePageReturnB"));
            returnButton.textContent = "Return to U.S. Map";
            returnButton.onclick = () => {
                playClick();
                onCountyMap = false;
                tooltipDiv.style.display = "none";
                tooltipComponents.properties.visible = false;
                tooltipComponents.properties.targetDistrict = null;
                onClickPageFunc();
            };
            if(projected) container.appendChild(returnButton);
            else container.insertBefore(returnButton, canvasElem);
        } else {
            const returnPresButton = document.getElementById("ePageReturnB2");
            if(returnPresButton) returnPresButton.remove();
        }

        if(!svgMap || svgMap.getAttribute("data-type") !== electionType || svgMap.getAttribute("data-source") !== mapPath){
            const origWidth = getCanvasDimension(canvasElem, "width", 800);
            const origHeight = getCanvasDimension(canvasElem, "height", 600);

            const mapDataText = fs.readFileSync(mapPath, "utf8");
            const mapData = (new DOMParser()).parseFromString(mapDataText, "image/svg+xml");

            if(svgMap && (svgMap.getAttribute("data-type") !== electionType || svgMap.getAttribute("data-source") !== mapPath)) svgMap.remove();

            {
                svgMap = mapData.documentElement;
                const baseWidth = +svgMap.getAttribute("width");
                const baseHeight = +svgMap.getAttribute("height");
                const containerDiv = document.createElement("div");

                svgMap.setAttribute("id", electionType + "-map" + (live ? "-live" : ""));
                svgMap.setAttribute("class", "better-maps-container")
                svgMap.setAttribute("width", origWidth);
                svgMap.setAttribute("height", origHeight);
                svgMap.setAttribute("data-type", electionType);
                svgMap.setAttribute("data-source", mapPath);

                if(config.mapBackground){
                    const currentColour = config.mapBackgroundColours[Executive.styles.currentTheme];
                    svgMap.setAttribute("style", `background: hsl(${currentColour.h}, ${currentColour.s}%, ${currentColour.l}%)`);
                }

                containerDiv.appendChild(svgMap);
                containerDiv.setAttribute("style", `width: ${origWidth}px; height: ${origHeight}px; overflow: hidden;`);
                container.insertBefore(containerDiv, canvasElem);
                canvasElem.setAttribute("style", "display: none;");

                createCrossHatches(svgMap);

                const scaleFactor = Math.min(origWidth / baseWidth, origHeight / baseHeight);
                const outlineGroup = svgMap.getElementsByTagName("g")[0];
                const statePaths = outlineGroup.children;

                for(let i = 0; i < statePaths.length; i++){
                    const stateId = statePaths[i].getAttribute("id");
                    statePaths[i].setAttribute("id", stateId.toLowerCase() + "-state-path" + (live ? "-live" : ""));
                    statePaths[i].setAttribute("class", "better-maps-state-path");
                    statePaths[i].setAttribute("style", `fill: #cccccc; transition: fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out; ${config.mapBorders ? "stroke: #ffffff; stroke-opacity: 0.6; stroke-width: 0.8px" : ""}`);

                    if(!onCountyMap){
                        statePaths[i].addEventListener("click", (event) => {
                            playClick();
                            activeMap = stateId;
                            if(electionType === "president") activeCampMap = Executive.data.states[stateId.toLowerCase()];
                            if(electionType !== "usHouse" && electionType !== "usHousePol"
                                && electionType !== "governorPol" && electionType !== "usSenatePol"){
                                onCountyMap = true;
                                tooltipDiv.style.display = "none";
                                tooltipComponents.properties.visible = false;
                                tooltipComponents.properties.targetDistrict = null;
                            }
                            onClickPageFunc();
                        });
                    }

                    if(electionType !== "usHousePol" && electionType !== "governorPol" && electionType !== "usSenatePol"){
                        
                        statePaths[i].addEventListener("mousemove", (event) => {
                            tooltipComponents.properties.visible = true;
                            tooltipComponents.properties.targetDistrict = stateId.toLowerCase();
                            updateTooltip(electionType, stateId.toLowerCase(), false, live, onCountyMap);
                            tooltipDiv.style.display = "block";
                            tooltipDiv.classList.add("is-visible");
                            moveTooltipSmoothly(event);
                        });
    
                        statePaths[i].addEventListener("mouseleave", (event) => {
                            tooltipDiv.classList.remove("is-visible");
                            setTimeout(() => {
                                if(tooltipComponents.properties.visible === false) tooltipDiv.style.display = "none";
                            }, 140);
                            tooltipComponents.properties.visible = false;
                            tooltipComponents.properties.targetDistrict = null;
                        });
                    }
                }

                if(!fitOutlineGroupToViewport(svgMap, outlineGroup, origWidth, origHeight)){
                    const preTransform = outlineGroup.getAttribute("transform");
                    if(scaleFactor === (origWidth / baseWidth)){
                        outlineGroup.setAttribute("transform", `${(preTransform === null ? "" : preTransform)} translate(0, ${(origHeight / 2) - ((baseHeight * scaleFactor) / 2)}) scale(${scaleFactor})`);
                    } else {
                        outlineGroup.setAttribute("transform", `${(preTransform === null ? "" : preTransform)} translate(${(origWidth / 2) - ((baseWidth * scaleFactor) / 2)}, 0) scale(${scaleFactor})`);
                    }
                }

                if(onCountyMap) updateCountyMap(svgMap, electionType, live);
                else updateMap(svgMap, resultColours, electionType, live, isProjected);
            };
        } else {
            if(onCountyMap) updateCountyMap(svgMap, electionType, live);
            else updateMap(svgMap, resultColours, electionType, live, isProjected);
        }

        if(live && electionType !== "usHousePol"){
            lastUpdateDataHook = Executive.functions.registerPostHook("electNightUpdateData", () => {
                if(tooltipComponents.properties.targetDistrict !== null)
                    updateTooltip(electionType, tooltipComponents.properties.targetDistrict, true, live, onCountyMap);
                
                checkAndShowProjections(electionType);
            });
        }

        if(tooltipComponents.properties.targetDistrict !== null)
            updateTooltip(electionType, tooltipComponents.properties.targetDistrict, true, live, onCountyMap);
    };

    const newElectPageMap = (canvasElem, resultColours, arg2, electionType) => {
        Executive.mods.saveData.testProp = "This is another test.";
        if(electionType !== "usSenate" && electionType !== "usHouse"
            && electionType !== "governor" && electionType !== "president")
            return originalElectPageMap(canvasElem, resultColours, arg2, electionType);
        let onClickPageFunc = null;
        switch(electionType){
            case "usSenate": onClickPageFunc = senateElectPage; break;
            case "usHouse": onClickPageFunc = houseElectPage; break;
            case "governor": onClickPageFunc = governorElectPage; break;
            case "president":
                onClickPageFunc = () => {
                    renderMap(canvasElem, resultColours, electionType, false, onClickPageFunc, true, true);
                    updateStDetails();
                };
                break;
        }
        renderMap(canvasElem, resultColours, electionType, false, onClickPageFunc, ((electionType === "president") ? true : undefined));
    };

    const newElectNightMap = (canvasElem, resultColours, arg2, electionType) => {
        if(electionType !== "usSenate" && electionType !== "usHouse"
            && electionType !== "governor" && electionType !== "president")
            return originalElectNightMap(canvasElem, resultColours, arg2, electionType);
        let onClickPageFunc = null;
        switch(electionType){
            case "usSenate": onClickPageFunc = electNightUSSFunc; break;
            case "usHouse": onClickPageFunc = electNightUSHFunc; break;
            case "governor": onClickPageFunc = electNightGovFunc; break;
            case "president":
                onClickPageFunc = electNightPresFunc;
                if(electNightP.elections[0].cands === undefined) onClickPageFunc = electNightPPFunc;
                break;
        }
        renderMap(canvasElem, resultColours, electionType, true, onClickPageFunc);
    };

    const newSimUSCanvas = (canvasElem, resultColours, arg2) => {
        renderMap(canvasElem, resultColours, "president", false, presElectPage);
    };

    const newSummaryNationMap = (canvasElem, resultColours, arg2, arg3) => {
        let electionType = "";
        if(openPolPage1 === "nation"){
            electionType = (openPolPage2 === "legislate1") ? "usHousePol" : "usSenatePol";
        } else {
            electionType = "governorPol";
        }
        let onClickPageFunc = null;
        switch(electionType){
            case "usSenatePol": onClickPageFunc = senatePolProfMenu; break;
            case "usHousePol": onClickPageFunc = housePolProfMenu; break;
            case "governorPol": onClickPageFunc = govPolProfMenu; break;
        }
        renderMap(canvasElem, resultColours, electionType, false, onClickPageFunc, true);
    };

    const createMapChangeObserver = (electionType) => () => {
        const projectButton = document.getElementById("eNightProjectB");
        if(projectButton){
            const buttonObserver = new MutationObserver((mutationList, observer) => {
                for(const mutation of mutationList){
                    if(mutation.type === "attributes" && mutation.attributeName === "class"){
                        const svgMap = document.getElementById(electionType + "-map-live");
                        if(svgMap){
                            newElectNightMap(document.getElementById("electNightCanvas"), JSON.parse(svgMap.getAttribute("data-colours")), 0, electionType);
                        }
                    }
                }
            });
            buttonObserver.observe(projectButton, {attributes: true});
        }
    };

    const addPartyID = () => {
        if(activeMap === "US") return;
        let sidePaneContainer = document.getElementById("electPageInn2Gen");
        if(!sidePaneContainer) sidePaneContainer = document.getElementById("electPageInn2Pri");
        const titleParagraph = sidePaneContainer.getElementsByClassName("electNightInnP")[0];
        const state = Executive.data.states[activeMap.toLowerCase()];
        const partyIDContainer = document.createElement("p");
        partyIDContainer.setAttribute("class", "summaryInnTopPRight");
        const demSpan = document.createElement("span");
        demSpan.setAttribute("style", "color: hsl(210, 100%, 60%);");
        demSpan.innerText = "D: " + Math.round(state.demPop * 100).toString() + "%";
        partyIDContainer.appendChild(demSpan);
        const repSpan = document.createElement("span");
        repSpan.setAttribute("style", "color: hsl(0, 100%, 60%);");
        repSpan.innerText = " R: " + Math.round(state.repPop * 100).toString() + "%";
        partyIDContainer.appendChild(repSpan);
        const indNode = document.createTextNode(" I: " + Math.round(state.indPop * 100).toString() + "%")
        partyIDContainer.appendChild(indNode);
        titleParagraph.appendChild(partyIDContainer);
    };

    mod.init = () => {
        Executive.styles.registerStyle("styles/general.css");
        Executive.styles.registerThemeAwareStyle("styles/light.css", "styles/dark.css");
        const configText = fs.readFileSync(Executive.mods.getRelativePathPrefix() + path.sep + "config.json", "utf8");
        config = JSON.parse(configText);
        createTooltip();
        createAlertContainer(); // Inicializa o container de alertas
        
        Executive.functions.registerReplacement("electPageMap", newElectPageMap);
        Executive.functions.registerReplacement("electNightMap", newElectNightMap);
        Executive.functions.registerReplacement("eSimUSCanvas", newSimUSCanvas);
        Executive.functions.registerReplacement("summaryNationMap", newSummaryNationMap);
        Executive.functions.registerPostHook("electNightUSSFunc", createMapChangeObserver("usSenate"));
        Executive.functions.registerPostHook("electNightGovFunc", createMapChangeObserver("governor"));
        Executive.functions.registerPostHook("electNightPresFunc", createMapChangeObserver("president"));
        if(config.showPanePartyID === true){
            Executive.functions.registerPostHook("houseElectPage", addPartyID);
            Executive.functions.registerPostHook("senateElectPage", addPartyID);
            Executive.functions.registerPostHook("governorElectPage", addPartyID);
        }
        Executive.styles.onThemeChange.registerListener((eventObj, darkMode) => {
            if(config.mapBackground){
                const currentColour = config.mapBackgroundColours[Executive.styles.currentTheme];
                const currentContainers = document.getElementsByClassName("better-maps-container");
                for(let i = 0; i < currentContainers.length; i++){
                    currentContainers[i].setAttribute("style", `background: hsl(${currentColour.h}, ${currentColour.s}%, ${currentColour.l}%)`);
                }
            }
        });
    };

    module.exports = mod;
}
