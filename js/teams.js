/**
 * @file teams.js
 * @description Manages the "Optimal Team Builder" page for the DC: Dark Legion Tools application.
 * This script handles:
 * - Firebase initialization and authentication.
 * - Fetching and displaying game data (champions, synergies, legacy pieces) from Firestore.
 * - Player champion roster management.
 * - Optimal team calculation using a dedicated TeamCalculator class.
 * - Saved teams management.
 * - UI interactions.
 * - URL parameter handling for viewing publicly shared teams, including dynamic banner generation.
 * - Firebase Analytics for tracking user events.
 *
 * @author Originally by the user, refactored and documented by Google's Gemini.
 * @version 3.4.0 - Add styled dropdown for champion selection
 */

// --- Firebase SDK Imports ---
import { getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc, getDoc, deleteDoc, query, setLogLevel, orderBy, addDoc, updateDoc, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";

// --- Custom Module Imports ---
import { createDynamicHeroBanner, loadComicsForHeroes } from './share.js';

// =================================================================================================
// #region: Constants & Global State
// =================================================================================================

// --- Icons ---
const ICON_ADD = '➕', ICON_UPDATE = '🔄', ICON_EDIT = '✏️', ICON_DELETE = '🗑️', ICON_CALCULATE = '⚙️', ICON_SAVE = '💾', ICON_CANCEL = '❌', ICON_SWAP = '🔁', ICON_RESET = '↩️', ICON_PREFILL = '✨', ICON_EXPORT = '📤', ICON_IMPORT = '📥', ICON_CONFIRM = '✔️', ICON_SHARE = '🔗', ICON_UNSHARE = '🚫', ICON_COPY = '📋', ICON_UPGRADE = '⬆️';

// --- App & Firebase Config ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'dc-dark-legion-builder';
const firebaseConfigProvided = { apiKey: "AIzaSyAzSQbS4LtAz20syWI2HREPR7UnYh6ldbI", authDomain: "dc-dark-legion-tools.firebaseapp.com", projectId: "dc-dark-legion-tools", storageBucket: "dc-dark-legion-tools.firebasestorage.app", messagingSenderId: "786517074225", appId: "1:786517074225:web:9f14dc4dcae0705fcfd010", measurementId: "G-FTF00DHGV6" };
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : firebaseConfigProvided;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Global State Variables ---
let app, auth, db, analytics;
let userId = null;
let rosterDataTable = null, scoreColumnVisible = true;
let teamNameModalCallback = null, confirmModalConfirmCallback = null, confirmModalCancelCallback = null;
let originalBestTeam = null, currentDisplayedTeam = null, currentBestTeamForSaving = null;
let championToReplaceIndex = -1;
let dbSynergies = [], dbChampions = [], dbLegacyPieces = [];
let playerChampionRoster = [], savedTeams = [];
let currentSelectedChampionClass = null, editingChampionId = null;

// --- DOM Element Selectors ---
const loadingIndicatorEl = document.getElementById('loading-indicator'), errorIndicatorEl = document.getElementById('error-indicator'), errorMessageDetailsEl = document.getElementById('error-message-details'), saveRosterIndicatorEl = document.getElementById('save-roster-indicator'), toggleScoreColumnCheckbox = document.getElementById('toggle-score-column'), synergiesSectionEl = document.getElementById('synergies-section'), synergiesListEl = document.getElementById('synergies-list'), toastContainer = document.getElementById('toast-container'), teamNameModalEl = document.getElementById('team-name-modal'), teamNameModalTitleEl = document.getElementById('team-name-modal-title'), teamNameInputEl = document.getElementById('team-name-input'), saveTeamNameBtn = document.getElementById('save-team-name-btn'), cancelTeamNameBtn = document.getElementById('cancel-team-name-btn'), processingModalEl = document.getElementById('processing-modal'), processingStatusTextEl = document.getElementById('processing-status-text'), progressBarInnerEl = document.getElementById('progress-bar-inner'), prefillRosterBtn = document.getElementById('prefill-roster-btn'), exportRosterBtn = document.getElementById('export-roster-btn'), importRosterBtn = document.getElementById('import-roster-btn'), importRosterFileEl = document.getElementById('import-roster-file'), confirmModalEl = document.getElementById('confirm-modal'), confirmModalTitleEl = document.getElementById('confirm-modal-title'), confirmModalMessageEl = document.getElementById('confirm-modal-message'), confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm-btn'), confirmModalCancelBtn = document.getElementById('confirm-modal-cancel-btn'), shareTeamModalEl = document.getElementById('share-team-modal'), shareTeamLinkInputEl = document.getElementById('share-team-link-input'), copyShareLinkBtn = document.getElementById('copy-share-link-btn'), closeShareTeamModalBtn = document.getElementById('close-share-team-modal-btn'), mainAppContentEl = document.getElementById('main-app-content'), sharedTeamViewSectionEl = document.getElementById('shared-team-view-section'), sharedTeamNameEl = document.getElementById('shared-team-name'), sharedTeamOutputEl = document.getElementById('shared-team-output'), formModeTitleEl = document.getElementById('form-mode-title'), champSelectDbEl = document.getElementById('champ-select-db'), champBaseRarityDisplayEl = document.getElementById('champ-base-rarity-display'), champClassDisplayEl = document.getElementById('champ-class-display'), champHealerStatusDisplayEl = document.getElementById('champ-healer-status-display'), champStarColorEl = document.getElementById('champ-star-color'), champInherentSynergiesDisplayEl = document.getElementById('champ-inherent-synergies-display'), gearSelectEls = { head: document.getElementById('gear-head'), arms: document.getElementById('gear-arms'), legs: document.getElementById('gear-legs'), chest: document.getElementById('gear-chest'), waist: document.getElementById('gear-waist'), }, legacyPieceSelectEl = document.getElementById('legacy-piece-select'), legacyPieceStarColorEl = document.getElementById('legacy-piece-star-color'), addUpdateChampionBtn = document.getElementById('add-update-champion-btn'), cancelEditBtn = document.getElementById('cancel-edit-btn'), championsRosterTableWrapperEl = document.getElementById('champions-roster-table-wrapper'), userIdDisplay = document.getElementById('userIdDisplay'), requireHealerCheckboxEl = document.getElementById('require-healer-checkbox'), excludeSavedTeamCheckboxEl = document.getElementById('exclude-saved-team-checkbox'), selectExclusionTeamDropdownEl = document.getElementById('select-exclusion-team-dropdown'), calculateBtn = document.getElementById('calculate-btn'), resultsOutputEl = document.getElementById('results-output'), savedTeamsListEl = document.getElementById('saved-teams-list');
const champForceLevelEl = document.getElementById('champ-force-level');
const swapChampionModalEl = document.createElement('div');
swapChampionModalEl.id = 'swap-champion-modal';
swapChampionModalEl.className = 'modal-backdrop hidden';
document.body.appendChild(swapChampionModalEl);
// Custom Dropdown Elements
const customChampDropdown = document.getElementById('custom-champ-dropdown');
const customChampDropdownTrigger = document.getElementById('custom-champ-dropdown-trigger');
const customChampDropdownOptions = document.getElementById('custom-champ-dropdown-options');
const selectedChampImg = document.getElementById('selected-champ-img');
const selectedChampName = document.getElementById('selected-champ-name');


// =================================================================================================
// #region: Data Definitions & Game Constants
// =================================================================================================

const STAR_COLOR_TIERS = { "Unlocked": 0.0, "White 1-Star": 1.0, "White 2-Star": 1.05, "White 3-Star": 1.10, "White 4-Star": 1.15, "White 5-Star": 1.20, "Blue 1-Star": 1.25, "Blue 2-Star": 1.30, "Blue 3-Star": 1.35, "Blue 4-Star": 1.40, "Blue 5-Star": 1.45, "Purple 1-Star": 1.50, "Purple 2-Star": 1.55, "Purple 3-Star": 1.60, "Purple 4-Star": 1.65, "Purple 5-Star": 1.70, "Gold 1-Star": 1.75, "Gold 2-Star": 1.80, "Gold 3-Star": 1.85, "Gold 4-Star": 1.90, "Gold 5-Star": 1.95, "Red 1-Star": 2.00, "Red 2-Star": 2.05, "Red 3-Star": 2.10, "Red 4-Star": 2.15, "Red 5-Star": 2.20 };
const LEGACY_PIECE_MODIFIER_PER_STAR_INCREMENT = 0.0025; 
const LEGACY_PIECE_STAR_TIER_MODIFIER = {};
function generateLegacyPieceStarTierModifiers() { LEGACY_PIECE_STAR_TIER_MODIFIER["Unlocked"] = 0; const colors = ["White", "Blue", "Purple", "Gold", "Red"]; let starStep = 0; colors.forEach(color => { for (let i = 1; i <= 5; i++) { starStep++; const tierName = `${color} ${i}-Star`; LEGACY_PIECE_STAR_TIER_MODIFIER[tierName] = starStep * LEGACY_PIECE_MODIFIER_PER_STAR_INCREMENT; } }); }
generateLegacyPieceStarTierModifiers();

const GAME_CONSTANTS = {
    CHAMPION_BASE_RARITY_SCORE: { "Epic": 100, "Legendary": 150, "Mythic": 220, "Limited Mythic": 260 },
    STANDARD_GEAR_RARITIES: ["None", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Mythic Enhanced"],
    STANDARD_GEAR_RARITY_MODIFIER: { "None": 0.0, "Uncommon": 0.02, "Rare": 0.05, "Epic": 0.10, "Legendary": 0.15, "Mythic": 0.20, "Mythic Enhanced": 0.25 },
    LEGACY_PIECE_BASE_RARITY_MODIFIER: { "None": 0.0, "Epic": 0.10, "Legendary": 0.15, "Mythic": 0.20, "Mythic+": 0.25 },
    STAR_COLOR_TIERS: STAR_COLOR_TIERS,
    LEGACY_PIECE_STAR_TIER_MODIFIER: LEGACY_PIECE_STAR_TIER_MODIFIER,
    FORCE_LEVEL_MODIFIER: { 0: 0.0, 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40, 5: 0.50 },
    SYNERGY_COUNT_MODIFIER: 0.15,
    CLASS_DIVERSITY_MULTIPLIER: 1.15,
    SYNERGY_ACTIVATION_COUNT: 3,
    SYNERGY_DEPTH_BONUS: 450,
    INDIVIDUAL_SCORE_WEIGHT: 1.25,
};

// =================================================================================================
// #region: Team Calculation Logic (CLASS-BASED REFACTOR)
// =================================================================================================

class TeamCalculator {
    constructor(allSynergies, gameConstants) {
        this.synergies = [...allSynergies].sort((a, b) => {
            if (a.bonusType === 'percentage' && b.bonusType !== 'percentage') return -1;
            if (a.bonusType !== 'percentage' && b.bonusType === 'percentage') return 1;
            return 0;
        });
        this.constants = gameConstants;
    }

    static calculateIndividualChampionScore(champion, gameConstants) {
        const baseScore = gameConstants.CHAMPION_BASE_RARITY_SCORE[champion.baseRarity] || 0;
        const starMultiplier = gameConstants.STAR_COLOR_TIERS[champion.starColorTier] || 1.0;
        if (starMultiplier === 1.0 && champion.starColorTier !== "White 1-Star" && champion.starColorTier !== "Unlocked") {
             console.warn(`Unknown starColorTier: ${champion.starColorTier} for champion ${champion.name}, defaulting to multiplier 1.0`);
        }
        const championCoreScore = baseScore * starMultiplier;

        let totalEquipmentMultiplier = 1.0;

        if (champion.gear && typeof champion.gear === 'object') {
            Object.values(champion.gear).forEach(gearPiece => {
                if (gearPiece && gearPiece.rarity) {
                    totalEquipmentMultiplier += gameConstants.STANDARD_GEAR_RARITY_MODIFIER[gearPiece.rarity] || 0;
                }
            });
        }

        const legacyPiece = champion.legacyPiece || {};
        if (legacyPiece.id && legacyPiece.rarity !== 'None') {
            const baseLpModifier = gameConstants.LEGACY_PIECE_BASE_RARITY_MODIFIER[legacyPiece.rarity] || 0;
            const lpStarModifier = gameConstants.LEGACY_PIECE_STAR_TIER_MODIFIER[legacyPiece.starColorTier] || 0;
            totalEquipmentMultiplier += baseLpModifier + lpStarModifier;
        }

        const forceLevel = champion.forceLevel || 0;
        const forceModifier = gameConstants.FORCE_LEVEL_MODIFIER[forceLevel] || 0;
        totalEquipmentMultiplier += forceModifier;

        const synergyCount = Array.isArray(champion.inherentSynergies) ? champion.inherentSynergies.length : 0;
        totalEquipmentMultiplier += synergyCount * (gameConstants.SYNERGY_COUNT_MODIFIER || 0);

        const finalScore = championCoreScore * totalEquipmentMultiplier;

        return finalScore;
    }

    evaluateTeam(teamMembers) {
        const baseScoreSum = teamMembers.reduce((sum, member) => sum + (member.individualScore || 0), 0);
        let scoreAfterPercentageSynergies = baseScoreSum;
        let totalPercentageBonusAppliedValue = 0;
        let accumulatedBaseFlatBonus = 0;
        const activeSynergiesForTeam = [];

        const teamSynergyCounts = new Map();
        teamMembers.forEach(member => {
            (member.inherentSynergies || []).forEach(synergyName => {
                teamSynergyCounts.set(synergyName, (teamSynergyCounts.get(synergyName) || 0) + 1);
            });
        });
        
        this.synergies.forEach(synergyDef => {
            const memberCount = teamSynergyCounts.get(synergyDef.name) || 0;
            if (memberCount === 0) {
                return;
            }

            const isTiered = synergyDef.tiers && Array.isArray(synergyDef.tiers) && synergyDef.tiers.length > 0;
            let calculatedBonus = 0;

            if (isTiered) {
                const applicableTier = synergyDef.tiers
                    .filter(tier => memberCount >= tier.countRequired)
                    .sort((a, b) => b.countRequired - a.countRequired)[0]; 
                
                if (applicableTier) {
                    calculatedBonus = (synergyDef.bonusValue || 0) * (applicableTier.countRequired || 0);
                    accumulatedBaseFlatBonus += calculatedBonus;

                    activeSynergiesForTeam.push({ 
                        name: synergyDef.name, 
                        description: applicableTier.tierDescription || synergyDef.description || '',
                        appliedAtMemberCount: memberCount,
                        bonusValue: synergyDef.bonusValue || 0,
                        bonusType: synergyDef.bonusType,
                        calculatedBonus: calculatedBonus
                    });
                }
            } else { 
                if (synergyDef.bonusValue && memberCount >= this.constants.SYNERGY_ACTIVATION_COUNT) {
                    if (synergyDef.bonusType === 'percentage') {
                        calculatedBonus = scoreAfterPercentageSynergies * (synergyDef.bonusValue / 100);
                        totalPercentageBonusAppliedValue += calculatedBonus;
                        scoreAfterPercentageSynergies += calculatedBonus;
                    } else if (synergyDef.bonusType === 'flat') {
                        calculatedBonus = synergyDef.bonusValue;
                        accumulatedBaseFlatBonus += calculatedBonus;
                    }
                    activeSynergiesForTeam.push({ 
                        name: synergyDef.name, 
                        description: synergyDef.description || '', 
                        appliedAtMemberCount: memberCount,
                        bonusValue: synergyDef.bonusValue,
                        bonusType: synergyDef.bonusType,
                        calculatedBonus: calculatedBonus
                    });
                }
            }
        });

        let subtotalAfterSynergies = scoreAfterPercentageSynergies + accumulatedBaseFlatBonus;
        
        let synergyDepthBonusValue = 0;
        teamSynergyCounts.forEach((memberCount, synergyName) => {
            const synergyDef = this.synergies.find(s => s.name === synergyName);
            if (!synergyDef) return;

            let minActivationCount = this.constants.SYNERGY_ACTIVATION_COUNT;
            if (synergyDef.tiers && synergyDef.tiers.length > 0) {
                const lowestTier = synergyDef.tiers.sort((a, b) => a.countRequired - b.countRequired)[0];
                if (lowestTier) {
                    minActivationCount = lowestTier.countRequired;
                }
            }
            
            if (memberCount > minActivationCount) {
                const extraMembers = memberCount - minActivationCount;
                synergyDepthBonusValue += extraMembers * (this.constants.SYNERGY_DEPTH_BONUS || 0);
            }
        });
        subtotalAfterSynergies += synergyDepthBonusValue;


        const uniqueClassesInTeam = new Set(teamMembers.map(m => m.class).filter(c => c && c !== "N/A"));
        let classDiversityBonusValue = 0;
        let finalTeamScore = subtotalAfterSynergies;
        let classDiversityBonusApplied = false;

        if (uniqueClassesInTeam.size >= 4) {
            classDiversityBonusValue = subtotalAfterSynergies * (this.constants.CLASS_DIVERSITY_MULTIPLIER - 1);
            finalTeamScore += classDiversityBonusValue;
            classDiversityBonusApplied = true;
        }
        
        const comparisonScore = finalTeamScore + (baseScoreSum * this.constants.INDIVIDUAL_SCORE_WEIGHT);

        return {
            members: teamMembers,
            totalScore: finalTeamScore,
            comparisonScore: comparisonScore,
            activeSynergies: activeSynergiesForTeam,
            baseScoreSum: baseScoreSum,
            uniqueClassesCount: uniqueClassesInTeam.size,
            classDiversityBonusApplied: classDiversityBonusApplied,
            scoreBreakdown: {
                base: baseScoreSum,
                percentageSynergyBonus: totalPercentageBonusAppliedValue,
                flatSynergyBonus: accumulatedBaseFlatBonus,
                synergyDepthBonus: synergyDepthBonusValue,
                subtotalAfterSynergies: subtotalAfterSynergies,
                classDiversityBonus: classDiversityBonusValue
            }
        };
    }

    async findOptimalTeam(roster, options) {
        const { requireHealer, updateProgress } = options;
        await updateProgress("Generating potential team combinations...", 12);
        
        let teamCombinations = [];
        if (requireHealer) {
            const healers = roster.filter(champ => champ.isHealer === true);
            if (healers.length === 0) throw new Error("No healers found to meet the 'Require Healer' criteria.");
            if (roster.length < 5) throw new Error("Not enough champions to form a team of 5 with a healer.");
            
            await updateProgress("Generating combinations with healers...", 15);
            healers.forEach(healer => {
                const otherChamps = roster.filter(champ => champ.id !== healer.id);
                if (otherChamps.length >= 4) {
                    const combinationsOfFour = generateCombinations(otherChamps, 4);
                    combinationsOfFour.forEach(combo => teamCombinations.push([healer, ...combo]));
                }
            });
        } else {
            await updateProgress("Generating general combinations...", 15);
            teamCombinations = generateCombinations(roster, 5);
        }

        if (teamCombinations.length === 0) throw new Error("Could not generate any valid teams with the current criteria.");
        await updateProgress(`Generated ${teamCombinations.length} combinations. Evaluating...`, 20);

        return new Promise((resolve) => {
            let bestTeam = null;
            let maxComparisonScore = -1; 
            let currentIndex = 0;
            const processBatch = () => {
                const batchEndTime = Date.now() + 16;
                while (Date.now() < batchEndTime && currentIndex < teamCombinations.length) {
                    const evaluatedTeam = this.evaluateTeam(teamCombinations[currentIndex]);
                    
                    if (evaluatedTeam.comparisonScore > maxComparisonScore) {
                        maxComparisonScore = evaluatedTeam.comparisonScore;
                        bestTeam = evaluatedTeam;
                    }
                    currentIndex++;
                }

                if (currentIndex < teamCombinations.length) {
                    const progress = 20 + Math.round((currentIndex / teamCombinations.length) * 75);
                    updateProgress(`Evaluating team ${currentIndex} of ${teamCombinations.length}...`, progress);
                    requestAnimationFrame(processBatch);
                } else {
                    updateProgress("Finalizing best team...", 98);
                    resolve(bestTeam);
                }
            };
            requestAnimationFrame(processBatch);
        });
    }
}

// =================================================================================================
// #region: Utility & UI Functions
// =================================================================================================

function ensureIndividualScores(members) { if (!members || !Array.isArray(members)) return []; return members.map(member => { const newMember = { ...member }; if (newMember.individualScore === undefined) { const baseChampDetails = dbChampions.find(c => c.id === newMember.dbChampionId) || {}; const memberForScoreCalc = { ...newMember, baseRarity: newMember.baseRarity || baseChampDetails.baseRarity, forceLevel: newMember.forceLevel || 0, inherentSynergies: newMember.inherentSynergies || baseChampDetails.inherentSynergies || [], legacyPiece: { ...(newMember.legacyPiece || {}), rarity: (newMember.legacyPiece && newMember.legacyPiece.rarity) ? newMember.legacyPiece.rarity : "None", starColorTier: (newMember.legacyPiece && newMember.legacyPiece.starColorTier) ? newMember.legacyPiece.starColorTier : "Unlocked" } }; newMember.individualScore = TeamCalculator.calculateIndividualChampionScore(memberForScoreCalc, GAME_CONSTANTS); } return newMember; }); }
function showToast(message, type = 'info', duration = 3000) { if (!toastContainer) return; const toast = document.createElement('div'); let baseClasses = 'toast mb-3 p-3 rounded-lg shadow-lg text-sm text-white flex justify-between items-center'; let typeClasses = ''; switch (type) { case 'success': typeClasses = 'bg-green-500'; break; case 'error': typeClasses = 'bg-red-500'; break; case 'warning': typeClasses = 'bg-yellow-500 text-black'; break; default: typeClasses = 'bg-blue-500'; break; } toast.className = `${baseClasses} ${typeClasses}`; const messageSpan = document.createElement('span'); messageSpan.textContent = message; toast.appendChild(messageSpan); const closeBtn = document.createElement('button'); closeBtn.innerHTML = '&times;'; closeBtn.className = 'ml-2 text-lg font-semibold leading-none focus:outline-none'; closeBtn.onclick = () => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }; toast.appendChild(closeBtn); toastContainer.appendChild(toast); toast.offsetHeight; toast.classList.add('show'); setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, duration); }
function showError(message, details = "") { if (loadingIndicatorEl) loadingIndicatorEl.classList.add('hidden'); if (errorIndicatorEl) { errorIndicatorEl.classList.remove('hidden'); const p = errorIndicatorEl.querySelector('p'); if (p) p.textContent = message; } if (errorMessageDetailsEl) errorMessageDetailsEl.textContent = details; showToast(message, 'error'); }
function getStarRatingHTML(starColorTier) { if (!starColorTier || starColorTier === "Unlocked") { return '<span class="unlocked-tier-text">Unlocked</span>'; } const parts = starColorTier.match(/(\w+)\s*(\d+)-Star/); if (!parts || parts.length < 3) { return `<span class="unlocked-tier-text">${starColorTier}</span>`; } const colorName = parts[1].toLowerCase(); const starCount = parseInt(parts[2], 10); let colorClass = ''; switch (colorName) { case 'red': colorClass = 'text-red-500'; break; case 'gold': colorClass = 'text-yellow-400'; break; case 'purple': colorClass = 'text-purple-500'; break; case 'blue': colorClass = 'text-blue-500'; break; case 'white': colorClass = 'text-slate-400'; break; default: colorClass = 'text-gray-500'; } let starsHTML = `<div class="star-rating inline-block" title="${starColorTier}">`; for (let i = 0; i < starCount; i++) { starsHTML += `<span class="${colorClass}">★</span>`; } starsHTML += `</div>`; return starsHTML; }
function getHealerPlaceholder() { const fallbackSpan = `<span class="icon-placeholder" style="display:none;">[H]</span>`; return `<span class="icon-wrapper"><img src="img/classes/Healer.png" alt="Healer" title="Healer" class="icon-class-table" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';"/>${fallbackSpan}</span>`; }
function getClassPlaceholder(className, customClasses = "icon-class-table") { const cn = (className || "N/A").trim().replace(/\s+/g, '_'); if (cn === "N/A" || cn === "") { return `<span class="icon-placeholder">[Class N/A]</span>`; } const fallbackSpan = `<span class="icon-placeholder" style="display:none;">[${cn.replace(/_/g, ' ')}]</span>`; return `<span class="icon-wrapper"><img src="img/classes/${cn}.png" alt="${cn.replace(/_/g, ' ')}" title="${cn.replace(/_/g, ' ')}" class="${customClasses}" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';"/>${fallbackSpan}</span>`; }
function generateCombinations(array, k) { const result = []; function backtrack(startIndex, currentCombination) { if (currentCombination.length === k) { result.push([...currentCombination]); return; } for (let i = startIndex; i < array.length; i++) { currentCombination.push(array[i]); backtrack(i + 1, currentCombination); currentCombination.pop(); } } backtrack(0, []); return result; }

// =================================================================================================
// #region: Firebase Initialization & Auth
// =================================================================================================

async function initializeFirebase() {
    return new Promise((resolve) => {
        document.addEventListener('firebase-ready', () => {
            try {
                app = getApp();
                auth = getAuth(app);
                db = getFirestore(app);
                analytics = getAnalytics(app);
                setLogLevel('error');

                if (loadingIndicatorEl) loadingIndicatorEl.classList.remove('hidden');
                if (errorIndicatorEl) errorIndicatorEl.classList.add('hidden');

                onAuthStateChanged(auth, (user) => {
                    if (user) {
                        userId = user.uid;
                        if (userIdDisplay) userIdDisplay.textContent = `User ID: ${userId.substring(0, 8)}...`;
                    } else {
                        userId = null;
                        if (userIdDisplay) userIdDisplay.textContent = "User ID: Please log in";
                        playerChampionRoster = [];
                        savedTeams = [];
                        renderPlayerChampionRoster();
                        renderSavedTeams();
                    }
                });
                resolve();
            } catch(e) {
                showError("Firebase initialization failed in teams.js: " + e.message);
                reject(e);
            }
        }, { once: true });
    });
}

// =================================================================================================
// #region: Data Fetching Functions
// =================================================================================================

async function fetchSynergiesAndRender() { if (!db) { showError("Firestore is not initialized."); return; } try { const querySnapshot = await getDocs(collection(db, `artifacts/${appId}/public/data/synergies`)); dbSynergies = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => (a.name || "").localeCompare(b.name || "")); renderAvailableSynergies(); } catch (error) { console.error("Error fetching synergies:", error); showError("Error fetching synergies.", error.message); dbSynergies = []; renderAvailableSynergies(); } }
async function fetchChampions() { if (!db) { showError("Firestore is not initialized."); return; } try { const querySnapshot = await getDocs(collection(db, `artifacts/${appId}/public/data/champions`)); dbChampions = querySnapshot.docs.map(doc => { const data = doc.data(); return { id: doc.id, ...data, isHealer: data.isHealer === true }; }); } catch (error) { console.error("Error fetching champions:", error); showError("Error fetching champions.", error.message); dbChampions = []; } }
async function fetchLegacyPieces() { if (!db) { showError("Firestore is not initialized."); return; } try { const querySnapshot = await getDocs(collection(db, `artifacts/${appId}/public/data/legacyPieces`)); dbLegacyPieces = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if (legacyPieceSelectEl) populateLegacyPieceSelect(); } catch (error) { console.error("Error fetching legacy pieces:", error); showError("Error fetching legacy pieces.", error.message); dbLegacyPieces = []; if (legacyPieceSelectEl) populateLegacyPieceSelect(); } }
async function loadPlayerRosterFromFirestore() {
    if (!userId || !db) {
        playerChampionRoster = [], renderPlayerChampionRoster(), renderAvailableSynergies();
        return
    }
    try {
        let e = await getDoc(doc(db, `artifacts/${appId}/users/${userId}/roster/myRoster`));
        if (e.exists()) {
            let r = e.data();
            r && Array.isArray(r.champions) ? (playerChampionRoster = r.champions.map(e => {
                let r = dbChampions.find(r => r.id === e.dbChampionId),
                    a = e.legacyPiece || {
                        id: null,
                        name: "None",
                        rarity: "None",
                        starColorTier: "Unlocked"
                    };
                return {
                    ...e,
                    id: e.id || Date.now() + Math.random(),
                    name: r ? r.name : e.name,
                    class: r ? r.class || "N/A" : e.class || "N/A",
                    isHealer: !!r && !0 === r.isHealer,
                    canUpgrade: r ? !!r.canUpgrade : false,
                    upgradeSynergy: r ? r.upgradeSynergy || null : null,
                    forceLevel: e.forceLevel || 0,
                    legacyPiece: {
                        ...a,
                        starColorTier: a.starColorTier || "Unlocked"
                    }
                }
            }), analytics && logEvent(analytics, "roster_loaded", {
                roster_size: playerChampionRoster.length
            })) : playerChampionRoster = []
        } else playerChampionRoster = []
    } catch (a) {
        console.error("Error loading player roster:", a), showError("Error loading your saved roster.", a.message), playerChampionRoster = []
    } finally {
        renderPlayerChampionRoster(), renderAvailableSynergies()
    }
}
async function loadSavedTeams(){if(userId&&db)try{let e=query(collection(db,`artifacts/${appId}/users/${userId}/savedTeams`),orderBy("createdAt","desc")),a=await getDocs(e);savedTeams=a.docs.map(e=>{let a=e.data(),r=(a.members||[]).map(e=>({...e,forceLevel:e.forceLevel||0,legacyPiece:{...e.legacyPiece||{},starColorTier:e.legacyPiece&&e.legacyPiece.starColorTier?e.legacyPiece.starColorTier:"Unlocked"}}));return{id:e.id,...a,members:r}}),renderSavedTeams()}catch(r){console.error("Error loading saved teams:",r),savedTeamsListEl&&(savedTeamsListEl.innerHTML='<p class="text-red-500">Error loading saved teams.</p>')}}

// =================================================================================================
// #region: UI Population & Rendering Functions
// =================================================================================================

function populateStarColorOptions(selectElement, tiersObject, defaultTier = "Unlocked") { if (!selectElement) return; selectElement.innerHTML = ''; Object.keys(tiersObject).forEach(tier => { const option = document.createElement('option'); option.value = tier; option.textContent = tier; selectElement.appendChild(option); }); if (tiersObject.hasOwnProperty(defaultTier)) { selectElement.value = defaultTier; } else if (Object.keys(tiersObject).length > 0) { selectElement.value = Object.keys(tiersObject)[0]; } }
function populateGearRarityOptions() { document.querySelectorAll('.gear-rarity-select').forEach(selectEl => { selectEl.innerHTML = ''; GAME_CONSTANTS.STANDARD_GEAR_RARITIES.forEach(rarity => { const option = document.createElement('option'); option.value = rarity; option.textContent = rarity; selectEl.appendChild(option); }); }); }
function populateForceLevelOptions() { if (!champForceLevelEl) return; champForceLevelEl.innerHTML = ''; for (let i = 0; i <= 5; i++) { const option = document.createElement('option'); option.value = i; option.textContent = i === 0 ? '0 (None)' : `${i} / 5`; champForceLevelEl.appendChild(option); } champForceLevelEl.value = 0; }
function renderAvailableSynergies() { if (!synergiesListEl) return; synergiesListEl.innerHTML = ''; if (dbSynergies.length === 0) { synergiesListEl.innerHTML = '<p class="text-sm text-gray-500 col-span-full">No synergies defined.</p>'; return; } dbSynergies.forEach(synergyDef => { const synergyItemContainer = document.createElement('div'); synergyItemContainer.className = 'synergy-item-container border rounded-lg p-3 bg-slate-50 mb-3 shadow-sm'; const count = playerChampionRoster.filter(champ => (champ.inherentSynergies || []).includes(synergyDef.name)).length; const synergyItemHeader = document.createElement('div'); synergyItemHeader.className = 'synergy-item-header flex items-center justify-between hover:bg-slate-100 p-2 rounded-md -m-2 mb-1 cursor-pointer'; synergyItemHeader.dataset.synergyName = synergyDef.name; const factionNameForIcon = synergyDef.name.trim().replace(/\s+/g, '_'); const fallbackSpan = `<span class="icon-placeholder" style="display:none;">[${synergyDef.name}]</span>`; const collapseIndicator = document.createElement('span'); collapseIndicator.className = 'collapse-indicator text-lg font-bold ml-auto mr-2'; collapseIndicator.textContent = '+'; synergyItemHeader.innerHTML = `<div class="flex items-center flex-grow"><span class="icon-wrapper mr-2"><img src="img/factions/${factionNameForIcon}.png" alt="${synergyDef.name}" title="${synergyDef.name}" class="w-6 h-6 object-contain" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';">${fallbackSpan}</span><span class="synergy-name">${synergyDef.name}</span></div><span class="synergy-progress">${count}/${(synergyDef.tiers && synergyDef.tiers.length > 0) ? synergyDef.tiers[0].countRequired : GAME_CONSTANTS.SYNERGY_ACTIVATION_COUNT}</span>`; const progressSpan = synergyItemHeader.querySelector('.synergy-progress'); if (progressSpan) { synergyItemHeader.insertBefore(collapseIndicator, progressSpan); } else { synergyItemHeader.appendChild(collapseIndicator); } synergyItemContainer.appendChild(synergyItemHeader); const contributingChampions = playerChampionRoster.filter(champ => (champ.inherentSynergies || []).includes(synergyDef.name)); const synergyContentDiv = document.createElement('div'); synergyContentDiv.className = 'synergy-content hidden'; if (contributingChampions.length > 0) { const championsListDiv = document.createElement('div'); championsListDiv.className = 'mt-2 pl-4 border-l-2 border-slate-200 space-y-1 synergy-champions-list'; contributingChampions.forEach(champ => { const champDiv = document.createElement('div'); champDiv.className = 'synergy-champion-entry flex items-center text-xs text-slate-600 py-1'; const classIconHtml = getClassPlaceholder(champ.class).replace('icon-class-table', 'result-icon w-4 h-4 mr-1'); const starRatingHTML = getStarRatingHTML(champ.starColorTier); let champSynergiesHtml = ''; if (champ.inherentSynergies && champ.inherentSynergies.length > 0) { champSynergiesHtml += `<div class="champion-synergies flex gap-0.5 ml-auto">`; champ.inherentSynergies.forEach(syn => { if (syn !== synergyDef.name) { const synNameForIcon = syn.trim().replace(/\s+/g, '_'); champSynergiesHtml += `<span class="icon-wrapper"><img src="img/factions/${synNameForIcon}.png" alt="${syn}" title="${syn}" class="result-icon w-3 h-3" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';"><span class="icon-placeholder text-xs" style="display:none;">[${syn}]</span></span>`; } }); champSynergiesHtml += `</div>`; } champDiv.innerHTML = `${classIconHtml}<span class="font-medium text-slate-700">${champ.name}</span><span class="star-rating star-rating-sm ml-2">${starRatingHTML.replace(/font-size: 1.2em;/g, 'font-size: 0.9em;')}</span>${champSynergiesHtml}`; championsListDiv.appendChild(champDiv); }); synergyContentDiv.appendChild(championsListDiv); } else { const noChampsP = document.createElement('p'); noChampsP.className = 'text-xs text-slate-500 mt-1 pl-4 no-champs-text'; noChampsP.textContent = 'No champions in roster have this synergy.'; synergyContentDiv.appendChild(noChampsP); } synergyItemContainer.appendChild(synergyContentDiv); synergyItemHeader.addEventListener('click', () => { const content = synergyItemContainer.querySelector('.synergy-content'); const indicator = synergyItemHeader.querySelector('.collapse-indicator'); if (content) { content.classList.toggle('hidden'); if (indicator) { indicator.textContent = content.classList.contains('hidden') ? '+' : '−'; } } if (analytics) logEvent(analytics, 'toggle_synergy_details', { synergy_name: synergyDef.name, is_collapsed: content ? content.classList.contains('hidden') : true }); }); synergiesListEl.appendChild(synergyItemContainer); }); }
function populateChampionSelect() {    if (!customChampDropdownOptions) return;    const currentSelectedValue = editingChampionId ? playerChampionRoster.find(c => c.id === editingChampionId)?.dbChampionId : champSelectDbEl.value;        customChampDropdownOptions.innerHTML = '';    customChampDropdownTrigger.disabled = true;    if (dbChampions.length === 0) {        selectedChampName.textContent = '-- No Champions Loaded --';        return;    }    const rosteredDbChampionIds = playerChampionRoster.map(rc => rc.dbChampionId);    const availableChampions = dbChampions.filter(dbChamp =>         !rosteredDbChampionIds.includes(dbChamp.id) || (editingChampionId && playerChampionRoster.find(c => c.id === editingChampionId)?.dbChampionId === dbChamp.id)    );    const sortedAvailableChampions = [...availableChampions].sort((a, b) => (a.name || "").localeCompare(b.name || ""));    const defaultOption = document.createElement('li');    defaultOption.className = 'px-4 py-2 text-gray-500';    defaultOption.textContent = '-- Select Champion --';    customChampDropdownOptions.appendChild(defaultOption);    sortedAvailableChampions.forEach(champ => {        if (!champ.id || !champ.name) return;                const optionEl = document.createElement('li');        optionEl.className = 'text-gray-900 cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-indigo-600 hover:text-white';        optionEl.setAttribute('role', 'option');        optionEl.dataset.value = champ.id;                const sanitizedName = (champ.name || "").replace(/[^a-zA-Z0-9-_]/g, "");        const imgSrc = `img/champions/avatars/${sanitizedName}.webp`;        optionEl.dataset.imgSrc = imgSrc;                optionEl.innerHTML = `            <div class="flex items-center">                <img src="${imgSrc}" alt="${champ.name}" class="h-6 w-6 flex-shrink-0 rounded-full" onerror="this.style.display='none'">                <span class="font-normal ml-3 block truncate">${champ.name}</span>            </div>        `;        optionEl.addEventListener('click', () => {            champSelectDbEl.value = optionEl.dataset.value;            selectedChampName.textContent = champ.name;            selectedChampImg.src = optionEl.dataset.imgSrc;            selectedChampImg.classList.remove('hidden');            customChampDropdownOptions.classList.add('hidden');            customChampDropdownTrigger.setAttribute('aria-expanded', 'false');            champSelectDbEl.dispatchEvent(new Event('change'));        });                customChampDropdownOptions.appendChild(optionEl);    });    customChampDropdownTrigger.disabled = false;    const currentChampionInList = sortedAvailableChampions.find(c => c.id === currentSelectedValue);    if (currentChampionInList) {        selectedChampName.textContent = currentChampionInList.name;        const sanitizedName = (currentChampionInList.name || "").replace(/[^a-zA-Z0-9-_]/g, "");        selectedChampImg.src = `img/champions/avatars/${sanitizedName}.webp`;        selectedChampImg.classList.remove('hidden');    } else if (!editingChampionId) {        resetChampionForm();    }}
function populateLegacyPieceSelect(championClass = null) { if (!legacyPieceSelectEl) return; const currentSelectedLegacyId = legacyPieceSelectEl.value; legacyPieceSelectEl.innerHTML = '<option value="">-- None --</option>'; if (dbLegacyPieces.length === 0) return; let filteredLegacyPieces = dbLegacyPieces; if (championClass && championClass !== "N/A") { const lowerChampionClass = championClass.toLowerCase(); filteredLegacyPieces = dbLegacyPieces.filter(lp => { const description = (lp.description || "").toLowerCase(); return description === "" || description.includes(lowerChampionClass); }); } else { filteredLegacyPieces = dbLegacyPieces.filter(lp => (lp.description || "") === ""); } const sortedLegacyPieces = [...filteredLegacyPieces].sort((a,b) => (a.name || "").localeCompare(b.name || "")); sortedLegacyPieces.forEach(lp => { if (!lp.id || !lp.name || !lp.baseRarity) return; const option = document.createElement('option'); option.value = lp.id; option.textContent = `${lp.name} (${lp.baseRarity})`; legacyPieceSelectEl.appendChild(option); }); if (sortedLegacyPieces.some(lp => lp.id === currentSelectedLegacyId)) { legacyPieceSelectEl.value = currentSelectedLegacyId; } }
function renderPlayerChampionRoster() {
    if (!championsRosterTableWrapperEl) return;
    if (rosterDataTable) {
        rosterDataTable.clear().destroy();
        rosterDataTable = null;
    }
    championsRosterTableWrapperEl.innerHTML = '';
    if (playerChampionRoster.length === 0) {
        championsRosterTableWrapperEl.innerHTML = '<p class="text-sm text-gray-500">No champions added to your roster yet.</p>';
        if (prefillRosterBtn) prefillRosterBtn.classList.remove('hidden');
    } else {
        if (prefillRosterBtn) prefillRosterBtn.classList.add('hidden');
        const table = document.createElement('table');
        table.id = 'rosterTable';
        table.className = 'display min-w-full';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr><th>Name</th><th>Rarity</th><th>Class</th><th class="dt-column-score">Score</th><th>Star/Color</th><th>Force</th><th>Legacy Piece</th><th>Actions</th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        playerChampionRoster.forEach(champ => {
            const tr = document.createElement('tr');
            let legacyDisplay = "None";
            let legacySortValue = 0;
            if (champ.legacyPiece && champ.legacyPiece.id && champ.legacyPiece.rarity !== "None") {
                legacyDisplay = `${champ.legacyPiece.name} (${champ.legacyPiece.rarity})`;
                const lpStarTier = champ.legacyPiece.starColorTier || "Unlocked";
                if (lpStarTier !== "Unlocked") legacyDisplay += ` <span class="text-xs whitespace-nowrap">${getStarRatingHTML(lpStarTier)}</span>`;
                legacySortValue = GAME_CONSTANTS.LEGACY_PIECE_BASE_RARITY_MODIFIER[champ.legacyPiece.rarity] || 0;
            }

            let upgradeButtonHtml = '';
            if (champ.baseRarity === 'Legendary' && champ.canUpgrade === true) {
                upgradeButtonHtml = `<button onclick="upgradeChampion(${champ.id})"><span class="btn-icon mr-2">${ICON_UPGRADE}</span> Upgrade</button>`;
            }

            const displayHealerIcon = champ.isHealer ? getHealerPlaceholder() : '';
            const displayClassIcon = getClassPlaceholder(champ.class);
            const individualScore = Math.round(TeamCalculator.calculateIndividualChampionScore(champ, GAME_CONSTANTS));
            const starRatingHTML = getStarRatingHTML(champ.starColorTier);
            const forceLevelDisplay = `${champ.forceLevel || 0} / 5`;
            tr.innerHTML = `<td data-sort="${champ.name}"><div class="flex items-center">${displayHealerIcon}<span class="ml-1">${champ.name}</span></div></td><td data-sort="${GAME_CONSTANTS.CHAMPION_BASE_RARITY_SCORE[champ.baseRarity] || 0}">${champ.baseRarity}</td><td data-sort="${champ.class || 'N/A'}">${displayClassIcon}</td><td class="dt-column-score" data-sort="${individualScore}">${individualScore}</td><td data-sort="${GAME_CONSTANTS.STAR_COLOR_TIERS[champ.starColorTier] || 0}">${starRatingHTML}</td><td data-sort="${champ.forceLevel || 0}">${forceLevelDisplay}</td><td data-sort="${legacySortValue}">${legacyDisplay}</td><td class="actions-cell">
                        <button class="actions-dropdown-trigger" data-action="toggle-dropdown">Actions...</button>
                        <div class="actions-dropdown-menu hidden">
                            ${upgradeButtonHtml}
                            <button onclick="editChampion(${champ.id})"><span class="btn-icon mr-2">${ICON_EDIT}</span> Edit</button>
                            <button onclick="removePlayerChampion(${champ.id})"><span class="btn-icon mr-2">${ICON_DELETE}</span> Remove</button>
                        </div>
                    </td>`;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        championsRosterTableWrapperEl.appendChild(table);
        if (typeof $ !== 'undefined' && $.fn.DataTable) {
            rosterDataTable = new $('#rosterTable').DataTable({
                responsive: true,
                "columnDefs": [{
                    "targets": [0, 1, 2, 4, 5, 6, 7],
                    "type": "string"
                }, {
                    "targets": 3,
                    "type": "num",
                    "className": "dt-column-score text-right"
                }],
                "order": [
                    [3, "desc"]
                ]
            });
            rosterDataTable.column('.dt-column-score').visible(scoreColumnVisible);
            if (toggleScoreColumnCheckbox) toggleScoreColumnCheckbox.checked = scoreColumnVisible;
        }
    }
    renderAvailableSynergies();
}
function renderSavedTeams() { if (!savedTeamsListEl || !selectExclusionTeamDropdownEl) return; savedTeamsListEl.innerHTML = ''; selectExclusionTeamDropdownEl.innerHTML = ''; if (savedTeams.length === 0) { savedTeamsListEl.innerHTML = '<p class="text-sm text-gray-500">No teams saved yet.</p>'; return; } const calculator = new TeamCalculator(dbSynergies, GAME_CONSTANTS); savedTeams.forEach(team => { const membersWithScores = ensureIndividualScores(team.members); const reEvaluatedTeam = calculator.evaluateTeam(membersWithScores); const teamContainerDiv = document.createElement('div'); teamContainerDiv.className = 'p-4 border rounded-lg bg-white shadow-lg mb-6'; let shareButtonHtml = team.publicShareId ? `<button class="btn btn-sm btn-info text-xs" onclick="unshareTeam('${team.id}', '${team.publicShareId}')"><span class="btn-icon">${ICON_UNSHARE}</span> Unshare</button>` : `<button class="btn btn-sm btn-success text-xs" onclick="shareTeam('${team.id}')"><span class="btn-icon">${ICON_SHARE}</span> Share</button>`; let publicLinkHtml = ''; if (team.publicShareId) { const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')); const shareUrl = `${window.location.origin}${basePath}/share.html?sharedTeamId=${team.publicShareId}`; publicLinkHtml = `<a href="${shareUrl}" target="_blank" class="text-xs text-blue-600 hover:underline mt-1 block">View Shared Team (ID: ${team.publicShareId.substring(0,6)}...)</a>`; } let teamHeaderHtml = `<div class="flex justify-between items-center mb-3 pb-2 border-b border-gray-200"><div><h4 class="font-semibold text-lg text-indigo-700">${team.name}</h4><p class="text-sm text-gray-600">Total Score: <strong class="text-pink-600">${Math.round(reEvaluatedTeam.totalScore)}</strong></p>${publicLinkHtml}</div><div class="flex-shrink-0 space-x-1">${shareButtonHtml}<button class="btn btn-sm btn-warning text-xs" onclick="renameSavedTeam('${team.id}', '${team.name.replace(/'/g, "\\'")}')"><span class="btn-icon">${ICON_EDIT}</span> Rename</button><button class="btn btn-sm btn-danger text-xs" onclick="deleteSavedTeam('${team.id}')"><span class="btn-icon">${ICON_DELETE}</span> Delete</button></div></div>`; teamContainerDiv.innerHTML = teamHeaderHtml; const membersGridDiv = document.createElement('div'); membersGridDiv.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3'; if (reEvaluatedTeam.members && Array.isArray(reEvaluatedTeam.members)) { reEvaluatedTeam.members.forEach(member => { const healerIconHtml = member.isHealer ? getHealerPlaceholder() : ''; const starRatingHTML = getStarRatingHTML(member.starColorTier); let individualScore = member.individualScore; let memberCardHtml = `<div class="p-3 border rounded-lg shadow-md bg-slate-50 flex flex-col justify-between champion-card"><div><div class="flex items-center mb-2">${getClassPlaceholder(member.class, 'result-icon class-icon mr-2')}<strong class="text-sm text-slate-800 leading-tight">${member.name}</strong>${healerIconHtml}</div><div class="text-xs text-slate-600 mb-2"><p>Tier: ${starRatingHTML}</p>`; if (member.forceLevel && member.forceLevel > 0) { memberCardHtml += `<p>Force: ${member.forceLevel} / 5</p>`; } memberCardHtml += `<p>Score: ${Math.round(individualScore)}</p>`; if (member.legacyPiece && member.legacyPiece.id) { memberCardHtml += `<p>Legacy: ${member.legacyPiece.name} (${member.legacyPiece.rarity})`; if (member.legacyPiece.starColorTier && member.legacyPiece.starColorTier !== "Unlocked") { memberCardHtml += ` <span class="whitespace-nowrap">${getStarRatingHTML(member.legacyPiece.starColorTier)}</span>`; } memberCardHtml += `</p>`; } memberCardHtml += `</div>`; if (member.inherentSynergies && member.inherentSynergies.length > 0) { memberCardHtml += `<div class="mt-1"><p class="text-xs font-semibold text-slate-500 mb-1">Synergies:</p><div class="flex flex-wrap gap-1">`; member.inherentSynergies.forEach(synergy => { const synergyNameForIcon = synergy.trim().replace(/\s+/g, '_'); memberCardHtml += `<span class="icon-wrapper"><img src="img/factions/${synergyNameForIcon}.png" alt="${synergy}" title="${synergy}" class="result-icon w-5 h-5" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';"><span class="icon-placeholder text-xs" style="display:none;">[${synergy}]</span></span>`; }); memberCardHtml += `</div></div>`; } memberCardHtml += `</div></div>`; membersGridDiv.innerHTML += memberCardHtml; }); } teamContainerDiv.appendChild(membersGridDiv); savedTeamsListEl.appendChild(teamContainerDiv); const option = document.createElement('option'); option.value = team.id; option.textContent = team.name; selectExclusionTeamDropdownEl.appendChild(option); }); }
function getTeamScoreCalculationHtml(t){if(!t||!t.scoreBreakdown)return"";let r=t.scoreBreakdown,o=`<h4 class="text-md font-semibold text-indigo-700 mb-2">Score Calculation:</h4><p>Base Individual Scores Sum: <strong class="float-right">${Math.round(r.base)}</strong></p>`;return t.activeSynergies.forEach(t=>{o+=`<p>${t.name} (${t.appliedAtMemberCount}): <strong class="text-green-600 float-right">+${Math.round(t.calculatedBonus)}</strong></p>`}),r.synergyDepthBonus>0&&(o+=`<p>Synergy Depth Bonus: <strong class="text-green-600 float-right">+${Math.round(r.synergyDepthBonus)}</strong></p>`),o+=`<p class="border-t border-indigo-200 pt-1 mt-1">Subtotal After Synergies: <strong class="float-right">${Math.round(r.subtotalAfterSynergies)}</strong></p>`,t.classDiversityBonusApplied&&(o+=`<p>Class Diversity Bonus (x${GAME_CONSTANTS.CLASS_DIVERSITY_MULTIPLIER}): <strong class="text-green-600 float-right">+${Math.round(r.classDiversityBonus)}</strong></p>`),`<div class="mb-4 p-3 bg-indigo-100 border border-indigo-300 rounded-lg text-sm">${o+=`<p class="border-t border-indigo-200 pt-1 mt-1 font-bold text-indigo-700">Final Team Score: <strong class="float-right">${Math.round(t.totalScore)}</strong></p>`}</div>`}
async function renderSharedTeam(e) {
    if (!sharedTeamOutputEl) return;
    if (!e || !e.members) return void(sharedTeamOutputEl.innerHTML = '<p class="text-red-500">Error: Invalid shared team data.</p>');
    let s = ensureIndividualScores(e.members),
        a = new TeamCalculator(dbSynergies, GAME_CONSTANTS).evaluateTeam(s),
        t = {
            ...e,
            ...a,
            members: s
        };
    sharedTeamNameEl && (sharedTeamNameEl.textContent = t.name || "Shared Team");
    let r = document.getElementById("heroSourceData");
    
    if (r) {
        const heroNamesForComics = [];
        r.innerHTML = "";
        t.members.forEach((e => {
            heroNamesForComics.push(e.name);
            let s = document.createElement("div");
            s.className = "hero-panel";
            let a = document.createElement("img"),
                t = `img/champions/avatars/${(e.name||"").replace(/[^a-zA-Z0-9-_]/g,"")}.webp`,
                n = `https://placehold.co/200x240/1a202c/e2e8f0?text=${encodeURIComponent(e.name||"Champion")}+Err`;
            a.src = t, a.alt = e.name || "Champion", a.crossOrigin = "anonymous", a.setAttribute("onerror", `this.dataset.error='true'; this.src='${n}';`), s.appendChild(a), r.appendChild(s)
        }));
        if (db) {
            loadComicsForHeroes(db, heroNamesForComics);
        }
    } else {
        console.error("The #heroSourceData container for the banner was not found.");
    }
    let n = "";
    n += getTeamScoreCalculationHtml(t), n += '<h4 class="text-md font-semibold text-gray-700 mt-3 mb-1">Score Contribution:</h4><div class="score-chart-container mb-2">';
    let l = t.totalScore > 0 ? t.totalScore : 1,
        i = t.scoreBreakdown.base / l * 100,
        o = t.scoreBreakdown.percentageSynergyBonus / l * 100,
        c = t.scoreBreakdown.flatSynergyBonus / l * 100,
        m = t.scoreBreakdown.classDiversityBonus / l * 100;
    i > 0 && (n += `<div class="score-chart-segment bg-blue-500" style="width:${i.toFixed(1)}%;" title="Base: ${Math.round(t.scoreBreakdown.base)}"></div>`), o > 0 && (n += `<div class="score-chart-segment bg-green-500" style="width:${o.toFixed(1)}%;" title="Perc. Synergy: +${Math.round(t.scoreBreakdown.percentageSynergyBonus)}"></div>`), c > 0 && (n += `<div class="score-chart-segment bg-teal-500" style="width:${c.toFixed(1)}%;" title="Flat Synergy: +${Math.round(t.scoreBreakdown.flatSynergyBonus)}"></div>`), m > 0 && t.classDiversityBonusApplied && (n += `<div class="score-chart-segment bg-purple-500" style="width:${m.toFixed(1)}%;" title="Class Div.: +${Math.round(t.scoreBreakdown.classDiversityBonus)}"></div>`), n += `</div><div class="flex justify-around mb-4">${i>0?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-blue-500 rounded-sm mr-1"></span>Base</span>':""}${o>0?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-green-500 rounded-sm mr-1"></span>% Syn.</span>':""}${c>0?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-teal-500 rounded-sm mr-1"></span>Flat Syn.</span>':""}${m>0&&t.classDiversityBonusApplied?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-purple-500 rounded-sm mr-1"></span>Class Div.</span>':""}</div>`;
    let d = void 0 !== t.uniqueClassesCount ? t.uniqueClassesCount : "N/A",
        p = t.members.map((e => e.class || "N/A")).filter(((e, s, a) => a.indexOf(e) === s && "N/A" !== e)).join(", ");
    n += `<p class="mb-2"><strong class="text-gray-700">Unique Classes:</strong> ${d} (${p||"None"})</p>`;
    let g = t.members.some((e => !0 === e.isHealer));
    n += `<p class="mb-4"><strong class="text-gray-700">Healer:</strong> <span class="${g?"text-green-600 font-semibold":"text-red-600"}">${g?"Yes":"No"}</span></p>`, n += '<h4 class="text-lg font-medium text-gray-700 mt-4 mb-2">Team Members:</h4><div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">', t.members.forEach((e => {
        let s = `img/champions/avatars/${(e.name||"").replace(/[^a-zA-Z0-9-_]/g,"")}.webp`,
            a = `https://placehold.co/150x200/e2e8f0/64748b?text=${encodeURIComponent(e.name||"Champion")}`,
            t = e.isHealer ? getHealerPlaceholder() : "",
            r = getStarRatingHTML(e.starColorTier);
        n += `<div class="p-3 border rounded-lg shadow-md bg-white flex flex-col justify-between champion-card"><img src="${s}" alt="${e.name||"Champion"}" class="w-full h-auto object-cover rounded-md mb-2" onerror="this.onerror=null; this.src='${a}';"><div><div class="flex items-center mb-2">${getClassPlaceholder(e.class,"result-icon class-icon mr-2")}<strong class="text-sm text-slate-800 leading-tight">${e.name}</strong>${t}</div><div class="text-xs text-slate-600 mb-2"><p>Tier: ${r}</p>`, e.forceLevel && e.forceLevel > 0 && (n += `<p>Force: ${e.forceLevel} / 5</p>`), n += `<p>Score: ${Math.round(e.individualScore||0)}</p>`, e.gear && (n += '<p class="mt-1 font-semibold">Gear:</p><ul class="list-disc list-inside ml-2">', Object.entries(e.gear).forEach((([e, s]) => {
            s && s.rarity && "None" !== s.rarity && (n += `<li>${e.charAt(0).toUpperCase()+e.slice(1)}: ${s.rarity}</li>`)
        })), n += "</ul>"), e.legacyPiece && e.legacyPiece.id && (n += `<p class="mt-1 font-semibold">Legacy: ${e.legacyPiece.name} (${e.legacyPiece.rarity})`, e.legacyPiece.starColorTier && "Unlocked" !== e.legacyPiece.starColorTier && (n += ` <span class="whitespace-nowrap">${getStarRatingHTML(e.legacyPiece.starColorTier)}</span>`), n += "</p>"), n += "</div>", e.inherentSynergies && e.inherentSynergies.length > 0 && (n += '<div class="mt-1"><p class="text-xs font-semibold text-slate-500 mb-1">Synergies:</p><div class="flex flex-wrap gap-1">', e.inherentSynergies.forEach((e => {
            let s = e.trim().replace(/\s+/g, "_");
            n += `<span class="icon-wrapper"><img src="img/factions/${s}.png" alt="${e}" title="${e}" class="result-icon w-5 h-5" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';"><span class="icon-placeholder text-xs" style="display:none;">[${e}]</span></span>`
        })), n += "</div></div>"), n += "</div></div>"
    })), n += "</div>", t.activeSynergies && t.activeSynergies.length > 0 ? (n += '<h4 class="text-lg font-medium text-gray-700 mt-6 mb-2">Active Team Synergies:</h4><div class="space-y-3">', t.activeSynergies.forEach((e => {
        const s = (e.name || "").trim().replace(/\s+/g, "_"),
            a = ` (+${Math.round(e.calculatedBonus)} Score)`,
            t = e.description || "Bonus Applied";
        n += `<div class="flex items-start">\n<img src="img/factions/${s}.png" alt="${e.name}" title="${e.name}" class="w-6 h-6 mr-3 flex-shrink-0" onerror="this.style.display='none'">\n                    <div class="text-sm">\n                        <strong>${e.name}</strong> (${e.appliedAtMemberCount} members): ${t}<span class="text-green-600 font-semibold">${a}</span>\n                    </div>\n                  </div>`
    })), n += "</div>") : n += '<p class="text-gray-600 mt-6">No active team synergies.</p>', sharedTeamOutputEl.innerHTML = n;
    let h = {
        bannerTitle: t.name || "Shared Team",
        pageDescription: `View the shared team: ${t.name}. Total Score: ${Math.round(t.totalScore)}.`
    };
    try {
        await createDynamicHeroBanner(h), analytics && logEvent(analytics, "hero_banner_generated", {
            team_name: t.name
        })
    } catch (e) {
        console.error("Error generating hero banner:", e), analytics && logEvent(analytics, "hero_banner_error", {
            team_name: t.name,
            error_message: e.message
        })
    }
}
function displayResults(teamToDisplay) { if (!resultsOutputEl) return; if (!teamToDisplay || !teamToDisplay.scoreBreakdown) { resultsOutputEl.innerHTML = '<p class="text-red-500">No optimal team determined.</p>'; currentBestTeamForSaving = null; originalBestTeam = null; currentDisplayedTeam = null; return; } originalBestTeam = JSON.parse(JSON.stringify(teamToDisplay)); currentDisplayedTeam = JSON.parse(JSON.stringify(teamToDisplay)); currentBestTeamForSaving = JSON.parse(JSON.stringify(teamToDisplay)); renderTeamDisplay(currentDisplayedTeam, true); }
function renderTeamDisplay(e,s=!0){if(!resultsOutputEl)return;if(!e||!e.scoreBreakdown)return void(resultsOutputEl.innerHTML='<p class="text-red-500">Invalid team data.</p>');let t=`<h3 class="text-xl font-semibold text-indigo-700 mb-3">Optimal Team ${s&&originalBestTeam&&JSON.stringify(e.members.map((e=>e.id)))!==JSON.stringify(originalBestTeam.members.map((e=>e.id)))?"(Modified)":""}</h3>`;t+=getTeamScoreCalculationHtml(e),t+='<h4 class="text-md font-semibold text-gray-700 mt-3 mb-1">Score Contribution:</h4><div class="score-chart-container mb-2">';const a=e.totalScore>0?e.totalScore:1,n=e.scoreBreakdown.base/a*100,l=e.scoreBreakdown.percentageSynergyBonus/a*100,r=e.scoreBreakdown.flatSynergyBonus/a*100,i=e.scoreBreakdown.classDiversityBonus/a*100;n>0&&(t+=`<div class="score-chart-segment bg-blue-500" style="width:${n.toFixed(1)}%;" title="Base: ${Math.round(e.scoreBreakdown.base)}"></div>`),l>0&&(t+=`<div class="score-chart-segment bg-green-500" style="width:${l.toFixed(1)}%;" title="Perc. Synergy: +${Math.round(e.scoreBreakdown.percentageSynergyBonus)}"></div>`),r>0&&(t+=`<div class="score-chart-segment bg-teal-500" style="width:${r.toFixed(1)}%;" title="Flat Synergy: +${Math.round(e.scoreBreakdown.flatSynergyBonus)}"></div>`),i>0&&(t+=`<div class="score-chart-segment bg-purple-500" style="width:${i.toFixed(1)}%;" title="Class Div.: +${Math.round(e.scoreBreakdown.classDiversityBonus)}"></div>`),t+=`</div><div class="flex justify-around mb-4">${n>0?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-blue-500 rounded-sm mr-1"></span>Base</span>':""}${l>0?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-green-500 rounded-sm mr-1"></span>% Syn.</span>':""}${r>0?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-teal-500 rounded-sm mr-1"></span>Flat Syn.</span>':""}${i>0?'<span class="score-chart-segment-label"><span class="inline-block w-3 h-3 bg-purple-500 rounded-sm mr-1"></span>Class Div.</span>':""}</div>`,t+=`<p class="mb-2"><strong class="text-gray-700">Unique Classes:</strong> ${e.uniqueClassesCount} (${e.members.map((e=>e.class||"N/A")).filter(((e,s,t)=>t.indexOf(e)===s&&"N/A"!==e)).join(", ")||"None"})</p>`;let c=e.members.some((e=>!0===e.isHealer));t+=`<p class="mb-4"><strong class="text-gray-700">Healer:</strong> <span class="${c?"text-green-600 font-semibold":"text-red-600"}">${c?"Yes":"No"}</span></p>`,t+='<h4 class="text-lg font-medium text-gray-700 mt-4 mb-2">Team Members:</h4><div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">',e.members.forEach(((e,a)=>{const n=e.isHealer?getHealerPlaceholder():"",l=getStarRatingHTML(e.starColorTier),r=s?`<button class="btn btn-sm btn-info btn-outline mt-2 w-full" onclick="handleOpenSwapModal(${a})"><span class="btn-icon">${ICON_SWAP}</span> Swap</button>`:"";t+=`<div class="p-3 border rounded-lg shadow-md bg-slate-50 flex flex-col justify-between champion-card"><div><div class="flex items-center mb-2">${getClassPlaceholder(e.class,"result-icon class-icon mr-2")}<strong class="text-sm text-slate-800 leading-tight">${e.name}</strong>${n}</div><div class="text-xs text-slate-600 mb-2"><p>Tier: ${l}</p>`,e.forceLevel&&e.forceLevel>0&&(t+=`<p>Force: ${e.forceLevel} / 5</p>`),t+=`<p>Score: ${Math.round(e.individualScore)}</p>`,e.legacyPiece&&e.legacyPiece.id&&(t+=`<p>Legacy: ${e.legacyPiece.name} (${e.legacyPiece.rarity})`,e.legacyPiece.starColorTier&&"Unlocked"!==e.legacyPiece.starColorTier&&(t+=` <span class="whitespace-nowrap">${getStarRatingHTML(e.legacyPiece.starColorTier)}</span>`),t+="</p>"),t+="</div>",e.inherentSynergies&&e.inherentSynergies.length>0&&(t+='<div class="mt-1"><p class="text-xs font-semibold text-slate-500 mb-1">Synergies:</p><div class="flex flex-wrap gap-1">',e.inherentSynergies.forEach((e=>{const s=e.trim().replace(/\s+/g,"_");t+=`<span class="icon-wrapper"><img src="img/factions/${s}.png" alt="${e}" title="${e}" class="result-icon w-5 h-5" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';"><span class="icon-placeholder text-xs" style="display:none;">[${e}]</span></span>`})),t+="</div></div>"),t+=`</div>${r}</div>`})),t+="</div>",e.activeSynergies.length>0?(t+='<h4 class="text-lg font-medium text-gray-700 mt-6 mb-2">Active Team Synergies:</h4><div class="space-y-3">',e.activeSynergies.forEach((e=>{const s=(e.name||"").trim().replace(/\s+/g,"_"),a=` (+${Math.round(e.calculatedBonus)} Score)`,n=e.description||"Bonus Applied";t+=`<div class="flex items-start">\n                       <img src="img/factions/${s}.png" alt="${e.name}" title="${e.name}" class="w-6 h-6 mr-3 flex-shrink-0" onerror="this.style.display='none'">\n                       <div class="text-sm">\n                           <strong>${e.name}</strong> (${e.appliedAtMemberCount} members): ${n}<span class="text-green-600 font-semibold">${a}</span>\n                       </div>\n                     </div>`})),t+="</div>"):t+='<p class="text-gray-600 mt-6">No active team synergies.</p>',t+=`<div class="mt-6 flex gap-2"><button id="save-team-btn" class="btn btn-success"><span class="btn-icon">${ICON_SAVE}</span> <span class="btn-text">Save This Team</span></button>`,s&&originalBestTeam&&JSON.stringify(e.members.map((e=>e.id)))!==JSON.stringify(originalBestTeam.members.map((e=>e.id)))&&(t+=`<button id="reset-team-btn" class="btn btn-outline btn-info"><span class="btn-icon">${ICON_RESET}</span> Reset to Original</button>`),t+="</div>",resultsOutputEl.innerHTML=t;const o=document.getElementById("save-team-btn");o&&o.addEventListener("click",saveCurrentBestTeam);const d=document.getElementById("reset-team-btn");d&&d.addEventListener("click",handleResetTeam)}

// =================================================================================================
// #region: Champion & Team Management (CRUD, Import/Export, Share)
// =================================================================================================

async function savePlayerRosterToFirestore() { if (!userId || !db) { showToast("Error: Not authenticated.", "error"); return; } if (saveRosterIndicatorEl) saveRosterIndicatorEl.classList.remove('hidden'); if (addUpdateChampionBtn) addUpdateChampionBtn.disabled = true; const rosterToSave = playerChampionRoster.map(champ => { const { individualScore, ...rest } = champ; return rest; }); try { await setDoc(doc(db, `artifacts/${appId}/users/${userId}/roster/myRoster`), { champions: rosterToSave }); showToast("Roster saved!", "success"); if (analytics) logEvent(analytics, 'roster_saved', { roster_size: playerChampionRoster.length }); } catch (error) { console.error("Error saving roster:", error); showToast("Failed to save roster: " + error.message, "error"); } finally { if (saveRosterIndicatorEl) saveRosterIndicatorEl.classList.add('hidden'); if (addUpdateChampionBtn) addUpdateChampionBtn.disabled = false; } }
function resetChampionForm() {    if (!champSelectDbEl) return;        champSelectDbEl.value = "";        if (selectedChampName) selectedChampName.textContent = '-- Select Champion --';    if (selectedChampImg) selectedChampImg.classList.add('hidden');    if (customChampDropdownTrigger) customChampDropdownTrigger.disabled = false;    if (champBaseRarityDisplayEl) champBaseRarityDisplayEl.value = "";    if (champClassDisplayEl) champClassDisplayEl.value = "";    if (champHealerStatusDisplayEl) champHealerStatusDisplayEl.value = "";    currentSelectedChampionClass = null;    populateStarColorOptions(champStarColorEl, GAME_CONSTANTS.STAR_COLOR_TIERS, "Unlocked");    populateStarColorOptions(legacyPieceStarColorEl, GAME_CONSTANTS.LEGACY_PIECE_STAR_TIER_MODIFIER, "Unlocked");    if (champForceLevelEl) champForceLevelEl.value = 0;    if (champInherentSynergiesDisplayEl) champInherentSynergiesDisplayEl.textContent = 'Select a champion to see synergies.';    Object.values(gearSelectEls).forEach(sel => { if (sel) sel.value = GAME_CONSTANTS.STANDARD_GEAR_RARITIES[0]; });    if (legacyPieceSelectEl) legacyPieceSelectEl.value = "";        populateLegacyPieceSelect(null);        if (addUpdateChampionBtn) addUpdateChampionBtn.innerHTML = `<span class="btn-icon">${ICON_ADD}</span> <span class="btn-text">Add Champion</span> <span id="save-roster-indicator" class="saving-indicator hidden"></span>`;    if (cancelEditBtn) cancelEditBtn.classList.add('hidden');}
window.editChampion = (championIdParam) => {    const championId = parseFloat(championIdParam);    const championToEdit = playerChampionRoster.find(c => c.id === championId);    if (!championToEdit) {        showToast(`Error: Champion with ID ${championId} not found.`, "error");        return;    }    editingChampionId = championId;    if (formModeTitleEl) formModeTitleEl.textContent = "Edit Champion";        if (champSelectDbEl) champSelectDbEl.value = championToEdit.dbChampionId;    if (selectedChampName) selectedChampName.textContent = championToEdit.name;    if (selectedChampImg) {        const sanitizedName = (championToEdit.name || "").replace(/[^a-zA-Z0-9-_]/g, "");        selectedChampImg.src = `img/champions/avatars/${sanitizedName}.webp`;        selectedChampImg.classList.remove('hidden');    }    if (customChampDropdownTrigger) customChampDropdownTrigger.disabled = true;    if (champBaseRarityDisplayEl) champBaseRarityDisplayEl.value = championToEdit.baseRarity;    if (champClassDisplayEl) champClassDisplayEl.value = championToEdit.class || "N/A";    if (champHealerStatusDisplayEl) champHealerStatusDisplayEl.value = championToEdit.isHealer ? 'Yes' : 'No';    currentSelectedChampionClass = championToEdit.class || null;    if (champStarColorEl) champStarColorEl.value = championToEdit.starColorTier;    if (legacyPieceStarColorEl) legacyPieceStarColorEl.value = (championToEdit.legacyPiece && championToEdit.legacyPiece.starColorTier) ? championToEdit.legacyPiece.starColorTier : "Unlocked";    if (champForceLevelEl) champForceLevelEl.value = championToEdit.forceLevel || 0;    if (champInherentSynergiesDisplayEl) champInherentSynergiesDisplayEl.textContent = (championToEdit.inherentSynergies || []).join(', ') || 'None';    if (gearSelectEls.head) gearSelectEls.head.value = championToEdit.gear.head.rarity;    if (gearSelectEls.arms) gearSelectEls.arms.value = championToEdit.gear.arms.rarity;    if (gearSelectEls.legs) gearSelectEls.legs.value = championToEdit.gear.legs.rarity;    if (gearSelectEls.chest) gearSelectEls.chest.value = championToEdit.gear.chest.rarity;    if (gearSelectEls.waist) gearSelectEls.waist.value = championToEdit.gear.waist.rarity;    populateLegacyPieceSelect(currentSelectedChampionClass);    if (legacyPieceSelectEl) legacyPieceSelectEl.value = (championToEdit.legacyPiece && championToEdit.legacyPiece.id) ? championToEdit.legacyPiece.id : "";        if (addUpdateChampionBtn) addUpdateChampionBtn.innerHTML = `<span class="btn-icon">${ICON_UPDATE}</span> <span class="btn-text">Update Champion</span> <span id="save-roster-indicator" class="saving-indicator hidden"></span>`;    if (cancelEditBtn) cancelEditBtn.classList.remove('hidden');        window.scrollTo({ top: customChampDropdownTrigger.offsetTop - 125, behavior: 'smooth' });    if (analytics) logEvent(analytics, 'edit_champion_start', { champion_name: championToEdit.name });};
function cancelEditMode() { editingChampionId = null; if (formModeTitleEl) formModeTitleEl.textContent = "Add Your Champions to Roster"; resetChampionForm(); if (cancelEditBtn) cancelEditBtn.classList.add('hidden'); if (customChampDropdownTrigger) customChampDropdownTrigger.disabled = false; populateChampionSelect(); if (analytics) logEvent(analytics, 'edit_champion_cancel'); }
window.removePlayerChampion = async (championIdParam) => { const championId = parseFloat(championIdParam); if (editingChampionId === championId) cancelEditMode(); const champToRemove = playerChampionRoster.find(c => c.id === championId); if (champToRemove) { openConfirmModal(`Delete ${champToRemove.name} from your roster?`, async () => { playerChampionRoster = playerChampionRoster.filter(c => c.id !== championId); renderPlayerChampionRoster(); await savePlayerRosterToFirestore(); showToast(`${champToRemove.name} removed.`, "info"); if (analytics) logEvent(analytics, 'remove_champion_from_roster', { champion_name: champToRemove.name }); populateChampionSelect(); }); } else { showToast(`Error: Champion ID ${championId} not found.`, "error"); } }
async function saveCurrentBestTeam() { if (!userId || !db) { showToast("You must be signed in to save.", "error"); return; } if (!currentDisplayedTeam) { showToast("No team to save.", "warning"); return; } const defaultTeamName = `Team (Score: ${Math.round(currentDisplayedTeam.totalScore)}) - ${new Date().toLocaleDateString()}`; openTeamNameModal(defaultTeamName, 'Save Team As', async (teamNameToSave) => { const teamDataToSave = { name: teamNameToSave, members: currentDisplayedTeam.members.map(m => ({ dbChampionId: m.dbChampionId, name: m.name, baseRarity: m.baseRarity, class: m.class, isHealer: m.isHealer === true, starColorTier: m.starColorTier, forceLevel: m.forceLevel || 0, gear: m.gear, legacyPiece: m.legacyPiece, inherentSynergies: m.inherentSynergies || [], individualScore: m.individualScore })), totalScore: currentDisplayedTeam.totalScore, activeSynergies: currentDisplayedTeam.activeSynergies, scoreBreakdown: currentDisplayedTeam.scoreBreakdown, baseScoreSum: currentDisplayedTeam.baseScoreSum, uniqueClassesCount: currentDisplayedTeam.uniqueClassesCount, classDiversityBonusApplied: currentDisplayedTeam.classDiversityBonusApplied, createdAt: serverTimestamp() }; const saveTeamBtnEl = document.getElementById('save-team-btn'); if(saveTeamBtnEl) saveTeamBtnEl.disabled = true; try { await addDoc(collection(db, `artifacts/${appId}/users/${userId}/savedTeams`), teamDataToSave); showToast("Team saved!", "success"); if (analytics) logEvent(analytics, 'save_team', { team_name: teamNameToSave, team_score: Math.round(teamDataToSave.totalScore) }); loadSavedTeams(); } catch (error) { console.error("Error saving team:", error); showToast("Failed to save team: " + error.message, "error"); } finally { if(saveTeamBtnEl) saveTeamBtnEl.disabled = false; } }); }
window.renameSavedTeam = async (teamId, currentName) => { if (!userId || !db) { showToast("Not signed in.", "error"); return; } openTeamNameModal(currentName, 'Rename Team', async (newName) => { if (newName && newName.trim() !== "" && newName.trim() !== currentName) { try { await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/savedTeams`, teamId), { name: newName.trim() }); showToast("Team renamed.", "success"); if (analytics) logEvent(analytics, 'rename_saved_team'); loadSavedTeams(); } catch (error) { console.error("Error renaming team:", error); showToast("Failed to rename team: " + error.message, "error"); } } }); };
window.deleteSavedTeam = async (teamId) => { if (!userId || !db) { showToast("Not signed in.", "error"); return; } const teamToDelete = savedTeams.find(t => t.id === teamId); if (!teamToDelete) { showToast("Team not found.", "error"); return; } openConfirmModal(`Delete team "${teamToDelete.name}"? If shared, the link will also be removed.`, async () => { try { if (teamToDelete.publicShareId) { await deleteDoc(doc(db, `artifacts/${appId}/public/data/sharedTeams`, teamToDelete.publicShareId)); showToast(`Public share removed.`, "info"); } await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/savedTeams`, teamId)); showToast(`"${teamToDelete.name}" deleted.`, "success"); if (analytics) logEvent(analytics, 'delete_saved_team', { was_shared: !!teamToDelete.publicShareId }); loadSavedTeams(); } catch (error) { console.error("Error deleting team:", error); showToast("Failed to delete team: " + error.message, "error"); } }); };
window.shareTeam = async (teamId) => { if (!userId || !db) { showToast("Not signed in.", "error"); return; } const teamToShare = savedTeams.find(t => t.id === teamId); if (!teamToShare) { showToast("Team not found.", "error"); return; } openConfirmModal(`Generate a public share link for "${teamToShare.name}"?`, async () => { try { const publicTeamData = { name: teamToShare.name, members: teamToShare.members, totalScore: teamToShare.totalScore, activeSynergies: teamToShare.activeSynergies, scoreBreakdown: teamToShare.scoreBreakdown, uniqueClassesCount: teamToShare.uniqueClassesCount, classDiversityBonusApplied: teamToShare.classDiversityBonusApplied, createdAt: serverTimestamp(), originalOwnerId: userId }; const docRef = await addDoc(collection(db, `artifacts/${appId}/public/data/sharedTeams`), publicTeamData); await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/savedTeams`, teamId), { publicShareId: docRef.id }); const shareLink = `${window.location.origin}${window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'))}/share.html?sharedTeamId=${docRef.id}`; openShareTeamModal(shareLink); showToast("Share link generated!", "success"); loadSavedTeams(); if (analytics) logEvent(analytics, 'share_team', { team_name: teamToShare.name }); } catch (error) { console.error("Error sharing team:", error); showToast("Failed to share team: " + error.message, "error"); } }, null, "Confirm Public Share" ); };
window.unshareTeam = async (savedTeamId, publicShareId) => { if (!userId || !db || !publicShareId || !savedTeamId) { showToast("Missing info to unshare.", "error"); return; } const teamToUnshare = savedTeams.find(t => t.id === savedTeamId); if (!teamToUnshare) { showToast("Team not found.", "error"); return; } openConfirmModal(`Remove public link for "${teamToUnshare.name}"?`, async () => { try { await deleteDoc(doc(db, `artifacts/${appId}/public/data/sharedTeams`, publicShareId)); await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/savedTeams`, savedTeamId), { publicShareId: deleteField() }); showToast(`"${teamToUnshare.name}" is no longer shared.`, "success"); loadSavedTeams(); if (analytics) logEvent(analytics, 'unshare_team'); } catch (error) { console.error("Error unsharing team:", error); showToast("Failed to unshare team: " + error.message, "error"); } }, null, "Confirm Unshare" ); };
async function handleSharedTeamLink() { const urlParams = new URLSearchParams(window.location.search); const sharedTeamId = urlParams.get('sharedTeamId'); const currentPagePath = window.location.pathname; if (sharedTeamId) { let basePath = currentPagePath.substring(0, currentPagePath.lastIndexOf('/')); if (basePath === "") basePath = "."; const sharePageUrl = `${window.location.origin}${basePath}/share.html?sharedTeamId=${sharedTeamId}`; if (!currentPagePath.includes('share.html')) { window.location.href = sharePageUrl; return true; } if (loadingIndicatorEl) loadingIndicatorEl.classList.remove('hidden'); if (mainAppContentEl) mainAppContentEl.classList.add('hidden'); if (sharedTeamViewSectionEl) { sharedTeamViewSectionEl.classList.remove('hidden'); if(sharedTeamOutputEl) sharedTeamOutputEl.innerHTML = '<div class="loading-spinner"></div><p class="text-center">Loading shared team...</p>'; } try { await fetchChampions(); await fetchSynergiesAndRender(); await fetchLegacyPieces(); const docSnap = await getDoc(doc(db, `artifacts/${appId}/public/data/sharedTeams`, sharedTeamId)); if (docSnap.exists()) { const sharedTeamData = docSnap.data(); await renderSharedTeam(sharedTeamData); if (analytics) logEvent(analytics, 'view_shared_team', { shared_team_id: sharedTeamId }); } else { if (sharedTeamOutputEl) sharedTeamOutputEl.innerHTML = '<p class="text-red-500 text-center">Shared team not found.</p>'; } } catch (error) { console.error("Error fetching shared team:", error); if (sharedTeamOutputEl) sharedTeamOutputEl.innerHTML = '<p class="text-red-500 text-center">Error loading data.</p>'; } finally { if (loadingIndicatorEl) loadingIndicatorEl.classList.add('hidden'); } return true; } else { if (currentPagePath.includes('share.html')) { if (sharedTeamOutputEl) sharedTeamOutputEl.innerHTML = '<p class="text-red-500 text-center">No team ID provided. <a href="teams.html" class="text-blue-600 hover:underline">Go to Team Builder</a></p>'; if (mainAppContentEl) mainAppContentEl.classList.add('hidden'); if (sharedTeamViewSectionEl) sharedTeamViewSectionEl.classList.remove('hidden'); return true; } } if (mainAppContentEl) mainAppContentEl.classList.remove('hidden'); if (sharedTeamViewSectionEl) sharedTeamViewSectionEl.classList.add('hidden'); return false; }
window.upgradeChampion = async (championIdParam) => {
    const championId = parseFloat(championIdParam);
    const championIndex = playerChampionRoster.findIndex(c => c.id === championId);
    
    if (championIndex === -1) {
        showToast("Error: Champion not found for upgrade.", "error");
        return;
    }

    const championToUpgrade = playerChampionRoster[championIndex];

    const confirmMessage = `Are you sure you want to upgrade ${championToUpgrade.name} from Legendary to Mythic? This will permanently update their base rarity.`;

    openConfirmModal(confirmMessage, async () => {
        if (championToUpgrade.upgradeSynergy && !championToUpgrade.inherentSynergies.includes(championToUpgrade.upgradeSynergy)) {
            playerChampionRoster[championIndex].inherentSynergies.push(championToUpgrade.upgradeSynergy);
        }

        playerChampionRoster[championIndex].baseRarity = "Mythic";
        playerChampionRoster[championIndex].canUpgrade = false;
        playerChampionRoster[championIndex].starColorTier = "Blue 5-Star";
        playerChampionRoster[championIndex].individualScore = TeamCalculator.calculateIndividualChampionScore(playerChampionRoster[championIndex], GAME_CONSTANTS);

        const finalUpgradedChampion = playerChampionRoster[championIndex];
        await recalculateAndUpdateSavedTeams(finalUpgradedChampion);

        renderPlayerChampionRoster();
        await savePlayerRosterToFirestore();

        showToast(`${championToUpgrade.name} has been upgraded to Mythic!`, "success");
        if (analytics) {
            logEvent(analytics, 'upgrade_champion', {
                champion_name: championToUpgrade.name 
            });
        }
    }, null, "Confirm Rarity Upgrade");
};
async function recalculateAndUpdateSavedTeams(upgradedChampion) {
    if (!savedTeams || savedTeams.length === 0 || !upgradedChampion) {
        return;
    }

    const teamsToUpdate = savedTeams.filter(team =>
        team.members.some(member => member.dbChampionId === upgradedChampion.dbChampionId)
    );

    if (teamsToUpdate.length === 0) {
        return;
    }

    showToast(`Found ${teamsToUpdate.length} saved team(s) to update...`, 'info');
    const calculator = new TeamCalculator(dbSynergies, GAME_CONSTANTS);

    await Promise.all(teamsToUpdate.map(async (team) => {
        const updatedMembers = team.members.map(member => {
            if (member.dbChampionId === upgradedChampion.dbChampionId) {
                return { ...upgradedChampion };
            }
            return member;
        });

        const membersWithScores = ensureIndividualScores(updatedMembers);
        const reEvaluatedTeam = calculator.evaluateTeam(membersWithScores);

        const dataToUpdate = {
            members: reEvaluatedTeam.members,
            totalScore: reEvaluatedTeam.totalScore,
            activeSynergies: reEvaluatedTeam.activeSynergies,
            scoreBreakdown: reEvaluatedTeam.scoreBreakdown,
            baseScoreSum: reEvaluatedTeam.baseScoreSum,
            uniqueClassesCount: reEvaluatedTeam.uniqueClassesCount,
            classDiversityBonusApplied: reEvaluatedTeam.classDiversityBonusApplied
        };

        const privateTeamDocRef = doc(db, `artifacts/${appId}/users/${userId}/savedTeams`, team.id);
        await updateDoc(privateTeamDocRef, dataToUpdate);

        if (team.publicShareId) {
            console.log(`Updating public share document: ${team.publicShareId}`);
            const publicTeamDocRef = doc(db, `artifacts/${appId}/public/data/sharedTeams`, team.publicShareId);
            await updateDoc(publicTeamDocRef, dataToUpdate);
        }

        const localTeamIndex = savedTeams.findIndex(t => t.id === team.id);
        if (localTeamIndex !== -1) {
            savedTeams[localTeamIndex] = { ...savedTeams[localTeamIndex], ...dataToUpdate };
        }
    }));

    renderSavedTeams();
    showToast(`${teamsToUpdate.length} saved team(s) and their share links successfully updated!`, 'success');
}

// =================================================================================================
// #region: Modal Management & Event Handlers
// =================================================================================================

function openProcessingModal() { if (!processingModalEl) return; updateProcessingStatus("Initializing...", 0); processingModalEl.classList.remove('hidden'); processingModalEl.classList.add('active'); }
function closeProcessingModal() { if (!processingModalEl) return; processingModalEl.classList.add('hidden'); processingModalEl.classList.remove('active'); }
function updateProcessingStatus(statusText, progressPercentage) { if (processingStatusTextEl) processingStatusTextEl.textContent = statusText; if (progressBarInnerEl) progressBarInnerEl.style.width = `${progressPercentage}%`; }
function openTeamNameModal(currentName = '', title = 'Enter Team Name', callback) { if (!teamNameModalEl) return; teamNameModalTitleEl.textContent = title; teamNameInputEl.value = currentName; teamNameModalCallback = callback; teamNameModalEl.classList.remove('hidden'); teamNameModalEl.classList.add('active'); teamNameInputEl.focus(); }
function closeTeamNameModal() { if (!teamNameModalEl) return; teamNameModalEl.classList.add('hidden'); teamNameModalEl.classList.remove('active'); teamNameInputEl.value = ''; teamNameModalCallback = null; }
function openConfirmModal(message, onConfirm, onCancel = null, title = "Confirm Action") { if (!confirmModalEl) { if (confirm(message)) { if (onConfirm) onConfirm(); } else { if (onCancel) onCancel(); } return; } confirmModalTitleEl.textContent = title; confirmModalMessageEl.textContent = message; confirmModalConfirmCallback = onConfirm; confirmModalCancelCallback = onCancel; confirmModalEl.classList.remove('hidden'); confirmModalEl.classList.add('active'); }
function closeConfirmModal() { if (!confirmModalEl) return; confirmModalEl.classList.add('hidden'); confirmModalEl.classList.remove('active'); confirmModalConfirmCallback = null; confirmModalCancelCallback = null; }
function openShareTeamModal(shareLink) { if (!shareTeamModalEl) return; shareTeamLinkInputEl.value = shareLink; shareTeamModalEl.classList.remove('hidden'); shareTeamModalEl.classList.add('active'); shareTeamLinkInputEl.focus(); shareTeamLinkInputEl.select(); }
function closeShareTeamModal() { if (!shareTeamModalEl) return; shareTeamModalEl.classList.add('hidden'); shareTeamModalEl.classList.remove('active'); }
window.handleOpenSwapModal = (indexToReplace) => { championToReplaceIndex = indexToReplace; if (!swapChampionModalEl.querySelector('.modal-content')) { swapChampionModalEl.innerHTML = `<div class="modal-content"><div class="flex justify-between items-center mb-4"><h3 id="swap-modal-title" class="text-xl font-semibold">Swap Champion</h3><button id="close-swap-modal-btn" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button></div><div id="swap-modal-body" class="text-sm max-h-96 overflow-y-auto"></div></div>`; const closeBtn = swapChampionModalEl.querySelector('#close-swap-modal-btn'); if (closeBtn) closeBtn.addEventListener('click', () => { swapChampionModalEl.classList.add('hidden'); swapChampionModalEl.classList.remove('active'); }); swapChampionModalEl.addEventListener('click', (event) => { if (event.target === swapChampionModalEl) { swapChampionModalEl.classList.add('hidden'); swapChampionModalEl.classList.remove('active'); } }); } const swapModalBody = swapChampionModalEl.querySelector('#swap-modal-body'); if (!swapModalBody || !currentDisplayedTeam) return; swapModalBody.innerHTML = ''; const currentTeamMemberIds = currentDisplayedTeam.members.map(m => m.dbChampionId); const availableToSwap = playerChampionRoster.filter(pChamp => !currentTeamMemberIds.includes(pChamp.dbChampionId)); if (availableToSwap.length === 0) { swapModalBody.innerHTML = '<p>No other champions available to swap.</p>'; } else { const ul = document.createElement('ul'); ul.className = 'list-none space-y-2'; availableToSwap.forEach(champ => { const li = document.createElement('li'); li.className = 'p-3 border rounded-md hover:bg-gray-100 cursor-pointer flex justify-between items-center'; li.dataset.champId = champ.id; const classIconHtml = getClassPlaceholder(champ.class, 'result-icon class-icon-swap mr-2'); const starRatingHTML = getStarRatingHTML(champ.starColorTier); let champDetailsHtml = `<div class="champion-details flex items-center">${classIconHtml}<strong class="text-slate-700">${champ.name}</strong><div class="star-rating ml-2">${starRatingHTML}</div></div>`; let champSynergiesHtml = ''; if (champ.inherentSynergies && champ.inherentSynergies.length > 0) { champSynergiesHtml += `<div class="champion-synergies flex gap-1 ml-auto">`; champ.inherentSynergies.forEach(synergy => { const synergyNameForIcon = synergy.trim().replace(/\s+/g, '_'); champSynergiesHtml += `<span class="icon-wrapper"><img src="img/factions/${synergyNameForIcon}.png" alt="${synergy}" title="${synergy}" class="result-icon w-4 h-4" onerror="this.style.display='none'; const fb = this.parentElement.querySelector('.icon-placeholder'); if (fb) fb.style.display='inline-block';"><span class="icon-placeholder text-xs" style="display:none;">[${synergy}]</span></span>`; }); champSynergiesHtml += `</div>`; } li.innerHTML = champDetailsHtml + champSynergiesHtml; li.addEventListener('click', () => { handleChampionSwap(champ.id, championToReplaceIndex); swapChampionModalEl.classList.add('hidden'); swapChampionModalEl.classList.remove('active'); }); ul.appendChild(li); }); swapModalBody.appendChild(ul); } swapChampionModalEl.classList.remove('hidden'); swapChampionModalEl.classList.add('active'); if (analytics && currentDisplayedTeam && currentDisplayedTeam.members[indexToReplace]) { logEvent(analytics, 'open_swap_modal', { champion_to_replace_name: currentDisplayedTeam.members[indexToReplace].name }); } }

if (champSelectDbEl) { champSelectDbEl.addEventListener('change', (event) => { const selectedChampionId = event.target.value; if (selectedChampionId) { const selectedDbChampion = dbChampions.find(c => c.id === selectedChampionId); if (selectedDbChampion) { if (champBaseRarityDisplayEl) champBaseRarityDisplayEl.value = selectedDbChampion.baseRarity || 'N/A'; if (champClassDisplayEl) champClassDisplayEl.value = selectedDbChampion.class || 'N/A'; if (champHealerStatusDisplayEl) champHealerStatusDisplayEl.value = selectedDbChampion.isHealer ? 'Yes' : 'No'; currentSelectedChampionClass = selectedDbChampion.class || null; if (champInherentSynergiesDisplayEl) champInherentSynergiesDisplayEl.textContent = (selectedDbChampion.inherentSynergies || []).join(', ') || 'None'; } else { currentSelectedChampionClass = null; if (champHealerStatusDisplayEl) champHealerStatusDisplayEl.value = ''; } } else { if (champBaseRarityDisplayEl) champBaseRarityDisplayEl.value = ''; if (champClassDisplayEl) champClassDisplayEl.value = ''; if (champHealerStatusDisplayEl) champHealerStatusDisplayEl.value = ''; currentSelectedChampionClass = null; if (champInherentSynergiesDisplayEl) champInherentSynergiesDisplayEl.textContent = 'Select a champion to see synergies.'; } populateLegacyPieceSelect(currentSelectedChampionClass); }); }
if (cancelEditBtn) { cancelEditBtn.addEventListener('click', cancelEditMode); }
if (addUpdateChampionBtn) { addUpdateChampionBtn.addEventListener('click', async () => { const selectedDbChampionId = champSelectDbEl.value; const selectedLegacyPieceId = legacyPieceSelectEl.value; const selectedLegacyPieceStarTier = legacyPieceStarColorEl.value; const selectedForceLevel = parseInt(champForceLevelEl.value, 10) || 0; let legacyPieceData = { id: null, name: "None", rarity: "None", starColorTier: "Unlocked", description: "" }; if (selectedLegacyPieceId) { const dbLp = dbLegacyPieces.find(lp => lp.id === selectedLegacyPieceId); if (dbLp) { legacyPieceData = { id: dbLp.id, name: dbLp.name, rarity: dbLp.baseRarity, starColorTier: selectedLegacyPieceStarTier, description: dbLp.description || "" }; } } if (editingChampionId) { const championIndex = playerChampionRoster.findIndex(c => c.id === editingChampionId); if (championIndex === -1) { cancelEditMode(); return; } const baseChampionDataForUpdate = dbChampions.find(dbChamp => dbChamp.id === playerChampionRoster[championIndex].dbChampionId); playerChampionRoster[championIndex] = { ...playerChampionRoster[championIndex], isHealer: baseChampionDataForUpdate ? (baseChampionDataForUpdate.isHealer === true) : (playerChampionRoster[championIndex].isHealer === true), starColorTier: champStarColorEl.value, forceLevel: selectedForceLevel, gear: { head: { rarity: gearSelectEls.head.value }, arms: { rarity: gearSelectEls.arms.value }, legs: { rarity: gearSelectEls.legs.value }, chest: { rarity: gearSelectEls.chest.value }, waist: { rarity: gearSelectEls.waist.value }, }, legacyPiece: legacyPieceData, }; renderPlayerChampionRoster(); await savePlayerRosterToFirestore(); showToast(`${playerChampionRoster[championIndex].name} updated!`, "success"); if (analytics) logEvent(analytics, 'update_champion_roster', { champion_name: playerChampionRoster[championIndex].name }); cancelEditMode(); } else { if (!selectedDbChampionId) { showToast('Please select a champion.', 'warning'); return; } if (playerChampionRoster.some(rc => rc.dbChampionId === selectedDbChampionId)) { showToast('Champion already in roster.', 'warning'); return; } const baseChampionData = dbChampions.find(c => c.id === selectedDbChampionId); if (!baseChampionData) { showToast('Base champion data not found.', 'error'); return; } const playerChampion = { id: Date.now() + Math.random(), dbChampionId: baseChampionData.id, name: baseChampionData.name, baseRarity: baseChampionData.baseRarity, class: baseChampionData.class || "N/A", isHealer: baseChampionData.isHealer === true, inherentSynergies: baseChampionData.inherentSynergies || [], starColorTier: champStarColorEl.value, forceLevel: selectedForceLevel, gear: { head: { rarity: gearSelectEls.head.value }, arms: { rarity: gearSelectEls.arms.value }, legs: { rarity: gearSelectEls.legs.value }, chest: { rarity: gearSelectEls.chest.value }, waist: { rarity: gearSelectEls.waist.value }, }, legacyPiece: legacyPieceData }; playerChampionRoster.push(playerChampion); renderPlayerChampionRoster(); await savePlayerRosterToFirestore(); showToast(`${playerChampion.name} added!`, "success"); if (analytics) logEvent(analytics, 'add_champion_to_roster', { champion_name: playerChampion.name }); resetChampionForm(); populateChampionSelect(); } }); }
if (toggleScoreColumnCheckbox) { toggleScoreColumnCheckbox.addEventListener('change', function() { scoreColumnVisible = this.checked; if (rosterDataTable) rosterDataTable.column('.dt-column-score').visible(scoreColumnVisible); if(analytics) logEvent(analytics, 'toggle_score_column', { visible: scoreColumnVisible }); }); }
if (calculateBtn) { calculateBtn.addEventListener('click', async () => { if (editingChampionId) { showToast("Finish editing before calculating.", "warning"); return; } if (playerChampionRoster.length < 5) { if (resultsOutputEl) resultsOutputEl.innerHTML = '<p class="text-red-500">Need at least 5 champions in roster.</p>'; return; } openProcessingModal(); try { let rosterForCombination = playerChampionRoster.map(rosterChamp => ({ ...rosterChamp, individualScore: TeamCalculator.calculateIndividualChampionScore(rosterChamp, GAME_CONSTANTS) })); if (excludeSavedTeamCheckboxEl.checked) { const exclusionTeamIds = Array.from(selectExclusionTeamDropdownEl.selectedOptions).map(option => option.value); if (exclusionTeamIds.length > 0) { const championsToExcludeIds = new Set(); exclusionTeamIds.forEach(teamId => { const teamToExclude = savedTeams.find(st => st.id === teamId); if (teamToExclude?.members) teamToExclude.members.forEach(member => championsToExcludeIds.add(member.dbChampionId)); }); rosterForCombination = rosterForCombination.filter(champ => !championsToExcludeIds.has(champ.dbChampionId)); if (rosterForCombination.length < 5) { throw new Error("Not enough champions remaining after exclusion."); } } } const calculator = new TeamCalculator(dbSynergies, GAME_CONSTANTS); const bestTeam = await calculator.findOptimalTeam(rosterForCombination, { requireHealer: requireHealerCheckboxEl.checked, updateProgress: (status, progress) => updateProcessingStatus(status, progress) }); if (analytics && bestTeam) logEvent(analytics, 'calculate_optimal_team', { roster_size: playerChampionRoster.length, best_team_score: Math.round(bestTeam.totalScore), require_healer: requireHealerCheckboxEl.checked }); displayResults(bestTeam); updateProcessingStatus("Calculation complete!", 100); setTimeout(closeProcessingModal, 1000); } catch (error) { console.error("Calculation Error:", error); if (resultsOutputEl) resultsOutputEl.innerHTML = `<p class="text-red-500">${error.message}</p>`; updateProcessingStatus(`Error: ${error.message}`, 100); setTimeout(closeProcessingModal, 2500); } }); }
if (saveTeamNameBtn) { saveTeamNameBtn.addEventListener('click', () => { const teamName = teamNameInputEl.value.trim(); if (teamName === "") { showToast("Name cannot be empty.", "warning"); return; } if (teamNameModalCallback) teamNameModalCallback(teamName); closeTeamNameModal(); }); }
if (cancelTeamNameBtn) { cancelTeamNameBtn.addEventListener('click', closeTeamNameModal); }
if (teamNameModalEl) { teamNameModalEl.addEventListener('click', (event) => { if (event.target === teamNameModalEl) closeTeamNameModal(); }); }
if (excludeSavedTeamCheckboxEl) { excludeSavedTeamCheckboxEl.addEventListener('change', () => { if (selectExclusionTeamDropdownEl) { selectExclusionTeamDropdownEl.disabled = !excludeSavedTeamCheckboxEl.checked; if (!excludeSavedTeamCheckboxEl.checked) Array.from(selectExclusionTeamDropdownEl.options).forEach(o => o.selected = false); } }); }
if (prefillRosterBtn) { prefillRosterBtn.addEventListener('click', async () => { const prefillAction = async () => { if (dbChampions.length === 0) { showToast("No champions loaded to pre-fill.", "error"); return; } playerChampionRoster = []; dbChampions.forEach(baseChamp => { const defaultGear = {}; Object.keys(gearSelectEls).forEach(slot => { defaultGear[slot] = { rarity: "None" }; }); playerChampionRoster.push({ id: Date.now() + Math.random(), dbChampionId: baseChamp.id, name: baseChamp.name, baseRarity: baseChamp.baseRarity, class: baseChamp.class || "N/A", isHealer: baseChamp.isHealer === true, inherentSynergies: baseChamp.inherentSynergies || [], starColorTier: "Unlocked", forceLevel: 0, gear: defaultGear, legacyPiece: { id: null, name: "None", rarity: "None", starColorTier: "Unlocked", description: "" } }); }); showToast("Roster pre-filled!", "success"); renderPlayerChampionRoster(); await savePlayerRosterToFirestore(); populateChampionSelect(); if (analytics) logEvent(analytics, 'prefill_roster', { champion_count: dbChampions.length }); }; if (playerChampionRoster.length > 0) { openConfirmModal("Replace current roster?", prefillAction); } else { openConfirmModal("Pre-fill roster with all champions?", prefillAction); } }); }
if (exportRosterBtn) { exportRosterBtn.addEventListener('click', () => { if (playerChampionRoster.length === 0) { showToast("Roster empty.", "warning"); return; } const exportableRoster = playerChampionRoster.map(c => ({ dbChampionId: c.dbChampionId, starColorTier: c.starColorTier, forceLevel: c.forceLevel || 0, gear: { head: { rarity: c.gear.head.rarity }, arms: { rarity: c.gear.arms.rarity }, legs: { rarity: c.gear.legs.rarity }, chest: { rarity: c.gear.chest.rarity }, waist: { rarity: c.gear.waist.rarity }, }, legacyPiece: { id: c.legacyPiece.id, starColorTier: c.legacyPiece.starColorTier || "Unlocked" } })); const jsonData = JSON.stringify(exportableRoster, null, 2); const blob = new Blob([jsonData], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'dc_dark_legion_roster.json'; a.click(); URL.revokeObjectURL(url); a.remove(); showToast("Roster exported!", "success"); if (analytics) logEvent(analytics, 'export_roster', { roster_size: playerChampionRoster.length }); }); }
if (importRosterBtn) { importRosterBtn.addEventListener('click', () => importRosterFileEl.click()); }
if (importRosterFileEl) { importRosterFileEl.addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; if (file.type !== "application/json") { showToast("Invalid file. Must be JSON.", "error"); importRosterFileEl.value = ''; return; } const reader = new FileReader(); reader.onload = (e) => { const processImport = async () => { try { const importedData = JSON.parse(e.target.result); if (!Array.isArray(importedData)) { showToast("Invalid roster format.", "error"); return; } const newRoster = []; let importErrors = 0; for (const importedChamp of importedData) { const baseChampionData = dbChampions.find(c => c.id === importedChamp.dbChampionId); if (!baseChampionData) { importErrors++; continue; } let legacyPieceData = { id: null, name: "None", rarity: "None", starColorTier: "Unlocked", description: "" }; if (importedChamp.legacyPiece && importedChamp.legacyPiece.id) { const dbLp = dbLegacyPieces.find(lp => lp.id === importedChamp.legacyPiece.id); if (dbLp) { const lpStarTier = importedChamp.legacyPiece.starColorTier || "Unlocked"; legacyPieceData = { id: dbLp.id, name: dbLp.name, rarity: dbLp.baseRarity, starColorTier: lpStarTier, description: dbLp.description || "" }; } } const playerChampion = { id: Date.now() + Math.random(), dbChampionId: baseChampionData.id, name: baseChampionData.name, baseRarity: baseChampionData.baseRarity, class: baseChampionData.class || "N/A", isHealer: baseChampionData.isHealer === true, inherentSynergies: baseChampionData.inherentSynergies || [], starColorTier: importedChamp.starColorTier || "Unlocked", forceLevel: importedChamp.forceLevel || 0, gear: { head: { rarity: importedChamp.gear?.head?.rarity || "None" }, arms: { rarity: importedChamp.gear?.arms?.rarity || "None" }, legs: { rarity: importedChamp.gear?.legs?.rarity || "None" }, chest: { rarity: importedChamp.gear?.chest?.rarity || "None" }, waist: { rarity: importedChamp.gear?.waist?.rarity || "None" }, }, legacyPiece: legacyPieceData }; newRoster.push(playerChampion); } playerChampionRoster = newRoster; renderPlayerChampionRoster(); await savePlayerRosterToFirestore(); populateChampionSelect(); if (importErrors > 0) { showToast(`Imported with ${importErrors} champion(s) skipped.`, "warning"); } else { showToast("Roster imported!", "success"); } if (analytics) logEvent(analytics, 'import_roster_success', { imported_count: newRoster.length, error_count: importErrors }); } catch (err) { console.error("Error importing roster:", err); showToast("Error importing roster: " + err.message, "error"); } finally { importRosterFileEl.value = ''; } }; openConfirmModal("Overwrite current roster?", processImport, () => { importRosterFileEl.value = ''; showToast("Import cancelled.", "info"); }); }; reader.readAsText(file); }); }
if (confirmModalConfirmBtn) { confirmModalConfirmBtn.addEventListener('click', () => { if (confirmModalConfirmCallback) confirmModalConfirmCallback(); closeConfirmModal(); }); }
if (confirmModalCancelBtn) { confirmModalCancelBtn.addEventListener('click', () => { if (confirmModalCancelCallback) confirmModalCancelCallback(); closeConfirmModal(); }); }
if (confirmModalEl) { confirmModalEl.addEventListener('click', (event) => { if (event.target === confirmModalEl) { if (confirmModalCancelCallback) confirmModalCancelCallback(); closeConfirmModal(); } }); }
if (closeShareTeamModalBtn) { closeShareTeamModalBtn.addEventListener('click', closeShareTeamModal); }
if (shareTeamModalEl) { shareTeamModalEl.addEventListener('click', (event) => { if (event.target === shareTeamModalEl) closeShareTeamModal(); }); }
if (copyShareLinkBtn) { copyShareLinkBtn.addEventListener('click', () => { if (!shareTeamLinkInputEl) return; try { shareTeamLinkInputEl.select(); document.execCommand('copy'); showToast("Link copied!", "success"); if (analytics) logEvent(analytics, 'share_link_copied'); } catch (err) { showToast("Failed to copy.", "warning"); } }); }
window.handleChampionSwap = async (selectedRosterChampIdParam, indexToReplace) => { const selectedRosterChampId = parseFloat(selectedRosterChampIdParam); const newChampion = playerChampionRoster.find(rc => rc.id === selectedRosterChampId); if (!newChampion || !currentDisplayedTeam || indexToReplace < 0 || indexToReplace >= currentDisplayedTeam.members.length) { showToast("Error during swap.", "error"); return; } const newTeamMembers = [...currentDisplayedTeam.members]; newTeamMembers[indexToReplace] = { ...newChampion, individualScore: TeamCalculator.calculateIndividualChampionScore(newChampion, GAME_CONSTANTS) }; openProcessingModal(); updateProcessingStatus("Recalculating score...", 10); setTimeout(() => { const calculator = new TeamCalculator(dbSynergies, GAME_CONSTANTS); const recalculatedTeam = calculator.evaluateTeam(newTeamMembers); currentDisplayedTeam = recalculatedTeam; currentBestTeamForSaving = JSON.parse(JSON.stringify(recalculatedTeam)); updateProcessingStatus("Updating display...", 90); renderTeamDisplay(currentDisplayedTeam, true); updateProcessingStatus("Complete!", 100); setTimeout(closeProcessingModal, 500); if (analytics) logEvent(analytics, 'execute_champion_swap', { swapped_in_champion_name: newChampion.name }); }, 50); }
window.handleResetTeam = () => { if (originalBestTeam) { currentDisplayedTeam = JSON.parse(JSON.stringify(originalBestTeam)); currentBestTeamForSaving = JSON.parse(JSON.stringify(originalBestTeam)); renderTeamDisplay(currentDisplayedTeam, true); showToast("Team reset.", "info"); if (analytics) logEvent(analytics, 'reset_displayed_team'); } }
document.addEventListener('click', function(event) {
    const target = event.target;
    const isDropdownTrigger = target.matches('[data-action="toggle-dropdown"]');
    
    const openDropdown = document.querySelector('.actions-dropdown-menu:not(.hidden)');

    if (isDropdownTrigger) {
        const dropdownMenu = target.nextElementSibling;
        
        if (openDropdown && openDropdown !== dropdownMenu) {
            openDropdown.classList.add('hidden');
        }
        
        dropdownMenu.classList.toggle('hidden');
    } else if (openDropdown && !openDropdown.contains(target) && !openDropdown.previousElementSibling.contains(target)) {
        openDropdown.classList.add('hidden');
    }
});

// =================================================================================================
// #region: Main Execution Block
// =================================================================================================

async function main() {
    try {
        await initializeFirebase();
        if (analytics) logEvent(analytics, 'page_view', { page_title: document.title, page_location: window.location.href });

        const sharedViewHandled = await handleSharedTeamLink();
        
        if (sharedViewHandled) {
             if (loadingIndicatorEl && !loadingIndicatorEl.classList.contains('hidden')) {
                loadingIndicatorEl.classList.add('hidden');
             }
             return;
        }

        if (document.getElementById('champions-section')) {
            populateStarColorOptions(champStarColorEl, GAME_CONSTANTS.STAR_COLOR_TIERS, "Unlocked");
            populateStarColorOptions(legacyPieceStarColorEl, GAME_CONSTANTS.LEGACY_PIECE_STAR_TIER_MODIFIER, "Unlocked");
            populateForceLevelOptions();
            populateGearRarityOptions();

            // Custom Dropdown Listeners
            customChampDropdownTrigger.addEventListener('click', () => {
                const isExpanded = customChampDropdownTrigger.getAttribute('aria-expanded') === 'true';
                customChampDropdownOptions.classList.toggle('hidden', isExpanded);
                customChampDropdownTrigger.setAttribute('aria-expanded', !isExpanded);
            });

            document.addEventListener('click', (event) => {
                if (customChampDropdown && !customChampDropdown.contains(event.target)) {
                    customChampDropdownOptions.classList.add('hidden');
                    customChampDropdownTrigger.setAttribute('aria-expanded', 'false');
                }
            });

            await fetchChampions();
            await fetchSynergiesAndRender();
            await fetchLegacyPieces();
            await loadPlayerRosterFromFirestore();
            await loadSavedTeams();

            populateChampionSelect();
            resetChampionForm();

            if (synergiesSectionEl) synergiesSectionEl.classList.remove('hidden');
            if (loadingIndicatorEl) loadingIndicatorEl.classList.add('hidden');
        }
    } catch (error) {
        if (analytics) logEvent(analytics, 'exception', { description: error.message, fatal: true });
        console.error("Main execution error:", error);
        if (loadingIndicatorEl) loadingIndicatorEl.classList.add('hidden');
        if (!errorIndicatorEl || !errorIndicatorEl.classList.contains('hidden')) {
            // Error already displayed or element missing
        } else {
            showError("An unexpected error occurred during page load.", error.message);
        }
    }
}

document.addEventListener('DOMContentLoaded', main);
