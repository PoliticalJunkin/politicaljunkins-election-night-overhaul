/* Better Election Maps â€“ better-maps/tooltip.js
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

    const getMunicipalityReportingRatio = (muniId, meta, source, live) => {
        if(!live || !source) return 1;
        const statewideRatio = Math.max(0, Math.min(1, safeNum(source.reportingRatio, 1)));
        if(statewideRatio >= 0.999) return 1;

        const turnoutWeight = Math.max(0.35, Math.min(2.4, safeNum(meta.turnoutWeight, 1)));
        const sizeDelay = Math.max(-0.10, Math.min(0.22, (turnoutWeight - 1) * 0.18));
        const hash = String(muniId || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const jitter = ((hash % 19) - 9) / 100;
        return Math.max(0, Math.min(0.99, statewideRatio - sizeDelay + jitter));
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
        const reportingRatio = getMunicipalityReportingRatio(muniId, meta, source, live);
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
            pW: !live || reportingRatio >= 0.999,
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

    const getCandidateLiveVotes = (cand) => {
        if(!cand) return undefined;
        const possible = [cand.currentVotes, cand.currVotes, cand.currentVote, cand.liveVotes, cand.reportingVotes];
        for(let i = 0; i < possible.length; i++){
            if(possible[i] !== undefined && possible[i] !== null) return possible[i];
        }
        return undefined;
    };

    const candidateVotes = (cand, live) => safeNum(live ? getCandidateLiveVotes(cand) : cand.votes, safeNum(cand.votes));
    const districtVotes = (district, live) => safeNum(live ? district.totalCurrVotes : district.totalVotes, safeNum(district.totalVotes));

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

    const getPrimaryCandidateName = (cand) => {
        if(!cand || !cand.name) return "Unknown";
        const parts = String(cand.name).trim().split(/\s+/);
        if(parts.length <= 1) return parts[0];
        const initials = parts.slice(0, -1)
            .filter(part => part.length > 0)
            .map(part => `${part.charAt(0).toUpperCase()}.`)
            .join(" ");
        return `${initials} ${parts[parts.length - 1]}`.trim();
    };

    const getCandidateAnimationKey = (cand) => {
        if(!cand) return "unknown";
        return `${getPartyKey(cand)}:${String(cand.name || "").toLowerCase()}`;
    };

    const candidateHasWinFlag = (cand) => {
        if(!cand) return false;
        return cand.pW === true
            || cand.winner === true
            || cand.won === true
            || cand.advanced === true
            || cand.advance === true
            || cand.advances === true
            || cand.nominated === true
            || cand.nominee === true
            || cand.primaryWinner === true
            || cand.runoff === true
            || cand.inRunoff === true
            || cand.topTwo === true
            || cand.topFour === true;
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

    const getHouseVotePartyKey = (cand) => {
        if(!cand) return "I";
        const party = String(cand.party || "").charAt(0).toUpperCase();
        if(party === "D" || party === "R") return party;
        const caucus = String(cand.caucus || cand.caucusParty || "").toLowerCase();
        if(caucus.charAt(0) === "d" || caucus.indexOf("dem") !== -1) return "D";
        if(caucus.charAt(0) === "r" || caucus.indexOf("rep") !== -1) return "R";
        return "I";
    };

    const normalizeCandidateText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const candidateImageCache = {};
    const candidateImageMissCache = {};

    const getCandidateCacheKey = (cand) => {
        const props = tooltipComponents && tooltipComponents.properties ? tooltipComponents.properties : {};
        return `${props.electionType || ""}:${props.districtId || ""}:${activeMap || ""}:${normalizeCandidateText(cand && cand.name)}:${getPartyLabel(cand).charAt(0)}`;
    };

    const getDirectCandidateImageSrc = (obj) => {
        if(!obj) return "";
        const possible = [
            obj.image,
            obj.img,
            obj.photo,
            obj.picture,
            obj.portrait,
            obj.portraitPath,
            obj.imagePath,
            obj.photoPath,
            obj.profileImage,
            obj.profilePic,
            obj.face,
            obj.avatar,
            obj.headshot,
            obj.headshotPath
        ];
        for(let i = 0; i < possible.length; i++){
            if(typeof possible[i] === "string" && possible[i].trim().length > 0) return possible[i];
        }
        return "";
    };

    const elementBelongsToTooltip = (elem) => {
        let current = elem;
        while(current){
            if(current === tooltipDiv) return true;
            current = current.parentElement;
        }
        return false;
    };

    const candidateTextScore = (text, cand) => {
        const normalizedText = normalizeCandidateText(text);
        const normalizedName = normalizeCandidateText(cand && cand.name);
        if(!normalizedText || !normalizedName) return 0;
        if(normalizedText.indexOf(normalizedName) !== -1) return 100;
        const parts = String(cand.name || "").trim().split(/\s+/).filter(Boolean);
        if(parts.length === 0) return 0;
        const lastName = normalizeCandidateText(parts[parts.length - 1]);
        const firstName = normalizeCandidateText(parts[0]);
        if(!lastName || normalizedText.indexOf(lastName) === -1) return 0;
        if(parts.length === 1) return 70;
        if(firstName && normalizedText.indexOf(firstName) !== -1) return 85;
        const initial = firstName ? firstName.charAt(0) : "";
        if(initial && normalizedText.indexOf(initial + lastName) !== -1) return 80;
        return 0;
    };

    const textMatchesCandidate = (text, cand) => candidateTextScore(text, cand) >= 80;

    const isPortraitSizedElement = (elem) => {
        if(!elem || !elem.getBoundingClientRect) return false;
        const rect = elem.getBoundingClientRect();
        if(rect.width < 35 || rect.height < 35 || rect.width > 190 || rect.height > 210) return false;
        const ratio = rect.width / Math.max(1, rect.height);
        return ratio >= 0.45 && ratio <= 1.55;
    };

    const getNearbyText = (elem) => {
        let current = elem;
        for(let depth = 0; current && depth < 7; depth++){
            let text = current.innerText || current.textContent || "";
            if(text && text.trim().length > 260) text = "";
            if((!text || text.trim().length === 0) && current.parentElement){
                const siblings = Array.from(current.parentElement.children || []);
                const index = siblings.indexOf(current);
                const nearby = [];
                if(index > 0) nearby.push(siblings[index - 1]);
                if(index >= 0 && index < siblings.length - 1) nearby.push(siblings[index + 1]);
                text = nearby.map(node => node.innerText || node.textContent || "").join(" ");
                if(text && text.trim().length > 260) text = "";
            }
            if(text && text.trim().length > 0) return text;
            current = current.parentElement;
        }
        return "";
    };

    const extractBackgroundImageUrl = (elem) => {
        if(!elem) return "";
        const bg = elem.style && elem.style.backgroundImage ? elem.style.backgroundImage : "";
        const match = /url\((['"]?)(.*?)\1\)/.exec(bg);
        return match && match[2] ? match[2] : "";
    };

    const getCandidateImageFromPage = (cand) => {
        if(!cand || !cand.name || typeof document === "undefined") return "";

        const imgs = Array.from(document.getElementsByTagName("img"));
        let bestSrc = "";
        let bestScore = 0;
        for(let i = 0; i < imgs.length; i++){
            const img = imgs[i];
            if(elementBelongsToTooltip(img)) continue;
            if(!isPortraitSizedElement(img)) continue;
            const src = img.currentSrc || img.src || img.getAttribute("src") || img.getAttribute("data-src") || "";
            const score = candidateTextScore(getNearbyText(img), cand);
            if(src && score > bestScore){
                bestScore = score;
                bestSrc = src;
            }
        }
        if(bestSrc && bestScore >= 80) return bestSrc;

        const elems = Array.from(document.querySelectorAll("[style]"));
        for(let i = 0; i < elems.length; i++){
            const elem = elems[i];
            if(elementBelongsToTooltip(elem)) continue;
            if(!isPortraitSizedElement(elem)) continue;
            const src = extractBackgroundImageUrl(elem);
            const score = candidateTextScore(getNearbyText(elem), cand);
            if(src && score > bestScore){
                bestScore = score;
                bestSrc = src;
            }
        }
        if(bestSrc && bestScore >= 80) return bestSrc;

        const canvases = Array.from(document.getElementsByTagName("canvas"));
        for(let i = 0; i < canvases.length; i++){
            const canvas = canvases[i];
            if(elementBelongsToTooltip(canvas)) continue;
            if(!isPortraitSizedElement(canvas)) continue;
            const score = candidateTextScore(getNearbyText(canvas), cand);
            if(score < 80) continue;
            try {
                const src = canvas.toDataURL("image/png");
                if(src) return src;
            } catch(err) {}
        }

        return "";
    };

    const getCandidateImageFromGameData = (cand) => {
        return "";
        if(!cand || !cand.name) return "";
        const seen = [];
        const party = getPartyLabel(cand).charAt(0);

        const searchObj = (obj, depth) => {
            if(!obj || depth > 6) return "";
            if(typeof obj !== "object") return "";
            if(seen.indexOf(obj) !== -1) return "";
            seen.push(obj);

            const direct = getDirectCandidateImageSrc(obj);
            const objParty = String(obj.party || obj.caucus || obj.caucusParty || "").charAt(0);
            if(direct && textMatchesCandidate(String(obj.name || obj.fullName || obj.firstName + " " + obj.lastName || ""), cand)
                && (!party || !objParty || objParty.toUpperCase() === party.toUpperCase())){
                return direct;
            }

            const keys = Object.keys(obj);
            for(let i = 0; i < keys.length; i++){
                const key = keys[i];
                if(key === "parentElement" || key === "children" || key === "ownerDocument") continue;
                const found = searchObj(obj[key], depth + 1);
                if(found) return found;
            }
            return "";
        };

        try {
            if(typeof Executive !== "undefined" && Executive.data){
                return searchObj(Executive.data.politicians, 0) || searchObj(Executive.data, 0);
            }
        } catch(err) {}
        return "";
    };

    const getCandidateImageSrc = (cand) => {
        if(!cand) return "";
        const cacheKey = getCandidateCacheKey(cand);
        if(candidateImageCache[cacheKey]) return candidateImageCache[cacheKey];
        if(candidateImageMissCache[cacheKey] && Date.now() - candidateImageMissCache[cacheKey] < 2500) return "";

        const direct = getDirectCandidateImageSrc(cand);
        if(direct){
            candidateImageCache[cacheKey] = direct;
            return direct;
        }
        if(cand.politician){
            const src = getCandidateImageSrc(cand.politician);
            if(src){
                candidateImageCache[cacheKey] = src;
                return src;
            }
        }
        if(cand.pol){
            const src = getCandidateImageSrc(cand.pol);
            if(src){
                candidateImageCache[cacheKey] = src;
                return src;
            }
        }
        const dataSrc = getCandidateImageFromGameData(cand);
        if(dataSrc){
            candidateImageCache[cacheKey] = dataSrc;
            return dataSrc;
        }
        const pageSrc = getCandidateImageFromPage(cand);
        if(pageSrc) candidateImageCache[cacheKey] = pageSrc;
        else candidateImageMissCache[cacheKey] = Date.now();
        return pageSrc;
    };

    const createCandidatePortrait = (cand) => {
        const slot = document.createElement("div");
        slot.className = `bm-nbc-portrait ${getPartyClass(cand)}`;

        const imageSrc = getCandidateImageSrc(cand);
        if(imageSrc){
            const img = document.createElement("img");
            img.className = "bm-nbc-portrait-img";
            img.src = imageSrc;
            img.onerror = () => {
                slot.classList.add("no-portrait");
                img.remove();
            };
            slot.appendChild(img);
        } else {
            slot.classList.add("no-portrait");
        }

        const label = document.createElement("span");
        label.className = "bm-nbc-portrait-party";
        label.innerText = getPartyLabel(cand).charAt(0) || "?";
        slot.appendChild(label);
        return slot;
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
        if(demDelta >= threshold) possible.push({ arrow: "â†", label: "BLUE", delta: demDelta, className: "trend-blue" });
        if(repDelta >= threshold) possible.push({ arrow: "â†’", label: "RED", delta: repDelta, className: "trend-red" });
        if(indShare >= 30 && indDelta >= threshold) possible.push({ arrow: "â–²", label: "GRAY", delta: indDelta, className: "trend-gray" });

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

    const createTooltipEntry = (cand, district, live, winner, primary) => {
        const row = document.createElement("div");
        row.className = `bm-nbc-row ${cand === winner ? "is-winner" : ""}`;
        row.setAttribute("data-candidate-key", getCandidateAnimationKey(cand));

        row.appendChild(createCandidatePortrait(cand));

        const name = document.createElement("div");
        name.className = "bm-nbc-name";
        name.innerText = primary ? getPrimaryCandidateName(cand) : getCandidateLastName(cand);
        const nameParty = document.createElement("span");
        nameParty.className = `bm-nbc-name-party ${getPartyClass(cand)}`;
        nameParty.innerText = getPartyLabel(cand).charAt(0) || "?";
        name.appendChild(nameParty);
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

        if(cand === winner || candidateHasWinFlag(cand)){
            const check = document.createElement("span");
            check.className = "bm-nbc-check";
            check.textContent = "\u2714";
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
                index,
                barWidth: row.querySelector(".bm-nbc-bar") ? row.querySelector(".bm-nbc-bar").style.width : "",
                votesText: row.querySelector(".bm-nbc-votes") ? row.querySelector(".bm-nbc-votes").innerText : "",
                pctText: row.querySelector(".bm-nbc-pct") ? row.querySelector(".bm-nbc-pct").innerText : ""
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
            const previous = previousPositions[key];

            const oldTop = previous.top;
            const newTop = row.getBoundingClientRect().top;
            const deltaY = oldTop - newTop;
            const bar = row.querySelector(".bm-nbc-bar");
            const votes = row.querySelector(".bm-nbc-votes");
            const pct = row.querySelector(".bm-nbc-pct");
            const targetBarWidth = bar ? bar.style.width : "";
            const valueChanged = (votes && previous.votesText !== votes.innerText) || (pct && previous.pctText !== pct.innerText);

            if(previous.index > index) row.classList.add("is-gaining-position");
            row.style.transition = "none";
            if(Math.abs(deltaY) >= 1) row.style.transform = `translateY(${deltaY}px)`;
            if(bar && previous.barWidth && previous.barWidth !== targetBarWidth){
                bar.style.transition = "none";
                bar.style.width = previous.barWidth;
            }
            row.getBoundingClientRect();
            requestAnimationFrame(() => {
                row.style.transition = "transform 720ms cubic-bezier(.16,.84,.24,1), background-color 460ms ease, box-shadow 460ms ease";
                row.style.transform = "translateY(0)";
                if(bar){
                    bar.style.transition = "width 760ms cubic-bezier(.16,.84,.24,1), background-color 420ms ease";
                    bar.style.width = targetBarWidth;
                }
                if(valueChanged){
                    row.classList.remove("is-value-updated");
                    row.getBoundingClientRect();
                    row.classList.add("is-value-updated");
                }
            });
        });
    };

    const appendHiddenCandidateCount = (count) => {
        if(count <= 0) return;
        const more = document.createElement("div");
        more.className = "bm-nbc-more-candidates";
        more.innerText = `+ ${count} MORE CANDIDATE${count === 1 ? "" : "S"}`;
        tooltipComponents.entries.appendChild(more);
    };

    const createCandidateTable = (district, live, primary) => {
        const stats = getRaceStats(district, live);
        const flaggedWinner = stats.cands.filter(candidateHasWinFlag)[0] || null;
        const winner = (district._countyView === true) ? null : (flaggedWinner || ((district.pW === true || !live) ? stats.leader : null));
        const maxRows = primary ? 4 : 3;
        stats.cands.slice(0, maxRows).forEach(candidate => tooltipComponents.entries.appendChild(createTooltipEntry(candidate, district, live, winner, primary)));
        appendHiddenCandidateCount(stats.cands.length - maxRows);
    };

    const getPrimaryDisplayCands = (cands, live) => {
        return (cands || []).map(cand => {
            const clone = Object.assign({}, cand);
            if(live && getCandidateLiveVotes(clone) === undefined) clone.currentVotes = 0;
            return clone;
        });
    };

    const buildPartyPrimaryBlock = (label, className, cands, live, parentDistrict) => {
        if(!cands || cands.length === 0) return;
        const header = document.createElement("div");
        header.className = `bm-nbc-primary-header ${className}`;
        header.innerText = label;
        tooltipComponents.entries.appendChild(header);

        const displayCands = getPrimaryDisplayCands(cands, live);
        const total = displayCands.reduce((sum, c) => sum + candidateVotes(c, live), 0);
        const finalTotal = cands.reduce((sum, c) => sum + candidateVotes(c, false), 0);
        const fullyReported = finalTotal > 0 && total >= finalTotal;
        const parentProjected = parentDistrict && (parentDistrict.pW === true || parentDistrict.projected === true || parentDistrict.final === true);
        const fakeDistrict = {
            totalVotes: finalTotal,
            totalCurrVotes: total,
            cands: displayCands,
            pW: displayCands.some(candidateHasWinFlag) || parentProjected || (!live && finalTotal > 0) || (live && fullyReported)
        };
        createCandidateTable(fakeDistrict, live, true);
    };

    const getPrimaryBlockParty = (block) => {
        const label = String(block && block.label || "").toLowerCase();
        const className = String(block && block.className || "").toLowerCase();
        if(label.indexOf("democratic") !== -1 || className.indexOf("dem") !== -1) return "D";
        if(label.indexOf("republican") !== -1 || className.indexOf("rep") !== -1) return "R";
        return "N";
    };

    const primaryPartyTotal = (block, live) => {
        if(!block || !block.cands) return 0;
        return getPrimaryDisplayCands(block.cands, live).reduce((sum, cand) => sum + candidateVotes(cand, live), 0);
    };

    const appendPrimaryTurnoutFooter = (district, live) => {
        const blocks = getPrimaryBlocks(district);
        const totals = { D: 0, R: 0, N: 0 };
        blocks.forEach(block => {
            totals[getPrimaryBlockParty(block)] += primaryPartyTotal(block, live);
        });
        const primaryInfo = getPrimaryAdvanceInfo(activeMap, district);
        const nonpartisanTotal = totals.N > 0 ? totals.N : totals.D + totals.R;
        const pieces = [];

        if(primaryInfo.nonpartisan || (totals.D === 0 && totals.R === 0)){
            pieces.push(`TURNOUT: ${formatNumber(nonpartisanTotal)}`);
        } else {
            if(totals.D > 0) pieces.push(`D TURNOUT: ${formatNumber(totals.D)}`);
            if(totals.R > 0) pieces.push(`R TURNOUT: ${formatNumber(totals.R)}`);
            if(totals.N > 0) pieces.push(`NONPARTISAN TURNOUT: ${formatNumber(totals.N)}`);
        }
        if(pieces.length === 0) return;
        const footer = document.createElement("div");
        footer.className = "bm-nbc-turnout-footer";
        footer.innerText = pieces.join("   ");
        tooltipComponents.entries.appendChild(footer);
    };

    const getPrimaryBlocks = (district) => {
        const blocks = [];
        const used = [];
        const getBlockCands = (value) => {
            if(!value) return null;
            if(Array.isArray(value.cands)) return value.cands;
            if(Array.isArray(value.candidates)) return value.candidates.map(c => {
                const clone = Object.assign({}, c);
                if(clone.votes === undefined && clone.totVotes !== undefined) clone.votes = clone.totVotes;
                if(clone.currentVotes === undefined && clone.currentTotVotes !== undefined) clone.currentVotes = clone.currentTotVotes;
                return clone;
            });
            return null;
        };
        const addBlock = (label, className, cands, party) => {
            if(!cands || cands.length === 0 || used.indexOf(cands) !== -1) return;
            used.push(cands);
            blocks.push({
                label,
                className,
                cands: cands.map(c => party ? Object.assign({ party }, c) : Object.assign({}, c))
            });
        };
        const demCands = getBlockCands(district.dem);
        const repCands = getBlockCands(district.rep);
        if(demCands && demCands.length !== 0){
            addBlock("DEMOCRATIC PRIMARY", "primary-dem", demCands, "D");
        }
        if(repCands && repCands.length !== 0){
            addBlock("REPUBLICAN PRIMARY", "primary-rep", repCands, "R");
        }
        const directCands = getBlockCands(district);
        if(blocks.length === 0 && directCands && directCands.length !== 0){
            addBlock("NONPARTISAN PRIMARY", "primary-nonpartisan", directCands, "");
        }
        if(blocks.length === 0){
            Object.keys(district || {}).forEach(key => {
                const value = district[key];
                const cands = getBlockCands(value);
                if(!cands || cands.length === 0) return;
                const normalizedKey = normalizeRuleText(key);
                if(normalizedKey.indexOf("dem") !== -1){
                    addBlock("DEMOCRATIC PRIMARY", "primary-dem", cands, "D");
                } else if(normalizedKey.indexOf("rep") !== -1){
                    addBlock("REPUBLICAN PRIMARY", "primary-rep", cands, "R");
                } else {
                    const label = normalizedKey.indexOf("runoff") !== -1 ? "NONPARTISAN RUNOFF" : "NONPARTISAN PRIMARY";
                    addBlock(label, "primary-nonpartisan", cands, "");
                }
            });
        }
        return blocks;
    };

    const isPrimaryDistrict = (district) => {
        if(!district) return false;
        if(district.dem || district.rep) return true;
        const text = normalizeRuleText(`${district.category || ""} ${district.type || ""} ${district.electionType || ""} ${district.name || ""}`);
        return text.indexOf("primary") !== -1;
    };

    const getHouseWinnerParty = (district, live) => {
        if(!district || !district.cands || district.cands.length === 0) return null;
        const cands = district.cands.slice().sort((a, b) => {
            const av = candidateVotes(a, live);
            const bv = candidateVotes(b, live);
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
            totalSeats: 0,
            votes: { D: 0, R: 0, I: 0 }
        };

        districts.forEach(district => {
            if(district && district.cands){
                district.cands.forEach(cand => {
                    summary.votes[getHouseVotePartyKey(cand)] += candidateVotes(cand, live);
                });
            }
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

    const appendHousePrimaryComposition = (houseState, live) => {
        const districts = houseState && houseState.districts ? houseState.districts : [];
        const turnout = { D: 0, R: 0, I: 0 };
        let primaryRaces = 0;

        districts.forEach(district => {
            if(!isPrimaryDistrict(district)) return;
            primaryRaces++;
            turnout.D += primaryPartyTotal(district.dem, live);
            turnout.R += primaryPartyTotal(district.rep, live);
            if(district.cands) turnout.I += primaryPartyTotal({ cands: district.cands }, live);
        });

        tooltipComponents.reporting.innerText = "PRIMARY RESULTS";
        tooltipComponents.reporting.style.display = "block";

        const metaLine = document.createElement("div");
        metaLine.className = "bm-nbc-meta-line";
        const seatNode = document.createElement("span");
        seatNode.className = "bm-nbc-margin";
        seatNode.innerText = `${primaryRaces}/${districts.length} HOUSE PRIMARIES`;
        metaLine.appendChild(seatNode);
        tooltipComponents.meta.appendChild(metaLine);

        const rows = [
            { party: "D", name: "Democratic Turnout", votes: turnout.D },
            { party: "R", name: "Republican Turnout", votes: turnout.R },
            { party: "I", name: "Nonpartisan Turnout", votes: turnout.I }
        ].filter(row => row.votes > 0 || row.party !== "I");

        const maxVotes = Math.max(1, ...rows.map(row => row.votes));
        rows.forEach(rowInfo => {
            const row = document.createElement("div");
            row.className = "bm-nbc-row bm-house-row";
            row.setAttribute("data-candidate-key", `house-primary:${rowInfo.party}`);

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
            votes.innerText = formatNumber(rowInfo.votes);
            row.appendChild(votes);

            const pctWrap = document.createElement("div");
            pctWrap.className = "bm-nbc-pct-wrap";
            const pctNode = document.createElement("div");
            pctNode.className = "bm-nbc-pct";
            pctNode.innerText = "votes";
            pctWrap.appendChild(pctNode);
            const barTrack = document.createElement("div");
            barTrack.className = "bm-nbc-bar-track";
            const bar = document.createElement("div");
            bar.className = "bm-nbc-bar";
            bar.style.width = `${Math.max(4, Math.min(100, (rowInfo.votes / maxVotes) * 100))}%`;
            const colour = rowInfo.party === "D" ? { h: 210, s: 100, l: 45 } : (rowInfo.party === "R" ? { h: 359, s: 100, l: 48 } : { h: 272, s: 78, l: 48 });
            bar.style.backgroundColor = stringifyColour(colour);
            barTrack.appendChild(bar);
            pctWrap.appendChild(barTrack);
            row.appendChild(pctWrap);
            tooltipComponents.entries.appendChild(row);
        });
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

        const voteSummary = getHouseSeatSummary(districts, live, false);

        const rows = [
            { party: "D", name: "Democrats", seats: called.D, leading: leading.D, votes: voteSummary.votes.D },
            { party: "R", name: "Republicans", seats: called.R, leading: leading.R, votes: voteSummary.votes.R },
            { party: "I", name: "Independents", seats: called.I, leading: leading.I, votes: voteSummary.votes.I }
        ].filter(row => row.seats > 0 || row.leading > 0 || row.party !== "I")
            .sort((a, b) => {
                if(b.seats !== a.seats) return b.seats - a.seats;
                if(b.leading !== a.leading) return b.leading - a.leading;
                return b.votes - a.votes;
            });

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
            pctNode.innerText = formatNumber(rowInfo.votes);
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
            if(currentDistrict.districts.some(isPrimaryDistrict)) appendHousePrimaryComposition(currentDistrict, live);
            else appendHouseComposition(currentDistrict, live);
            return;
        }

        if(currentDistrict.cands === undefined){
            tooltipComponents.reporting.innerText = "PRIMARY RESULTS";
            tooltipComponents.reporting.style.display = "block";
            appendPrimaryRuleMeta(electionType, currentDistrict, districtId, live, countyView);
            getPrimaryBlocks(currentDistrict).forEach(block => buildPartyPrimaryBlock(block.label, block.className, block.cands, live, currentDistrict));
            appendPrimaryTurnoutFooter(currentDistrict, live);
            return;
        }

        if(isPrimaryDistrict(currentDistrict)){
            tooltipComponents.reporting.innerText = "PRIMARY RESULTS";
            tooltipComponents.reporting.style.display = "block";
            appendPrimaryRuleMeta(electionType, currentDistrict, districtId, live, countyView);
            getPrimaryBlocks(currentDistrict).forEach(block => buildPartyPrimaryBlock(block.label, block.className, block.cands, live, currentDistrict));
            appendPrimaryTurnoutFooter(currentDistrict, live);
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
