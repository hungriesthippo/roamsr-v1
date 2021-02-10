/* eslint-disable no-console */
/* eslint-disable no-useless-escape */
/* eslint-disable no-underscore-dangle */
/* global roamsr */
if (!window.roamsr) window.roamsr = {};

// --- Schedulers / algorithms ---
roamsr.ankiScheduler = (userConfig) => {
  const defaultConfig = {
    defaultFactor: 2.5,
    firstFewIntervals: [1, 6],
    factorModifier: 0.15,
    easeBonus: 1.3,
    hardFactor: 1.2,
    minFactor: 1.3,
    jitterPercentage: 0.05,
    maxInterval: 50 * 365,
    responseTexts: ["Again.", "Hard.", "Good.", "Easy."],
  };
  const config = Object.assign(defaultConfig, userConfig);

  const algorithm = (history) => {
    let historySinceFail = [];
    if (history) {
      const lastFail =
        history.map((review) => review.signal).lastIndexOf("1") + 1;
      historySinceFail = lastFail === -1 ? history : history.slice(lastFail);
    }
    // Check if in learning phase
    if (
      historySinceFail.length === 0 ||
      historySinceFail.length < config.firstFewIntervals.length
    ) {
      return [
        {
          responseText: config.responseTexts[0],
          signal: 1,
          interval: 0,
        },
        {
          responseText: config.responseTexts[2],
          signal: 3,
          interval:
            config.firstFewIntervals[
              history ? Math.max(history.length - 1, 0) : 0
            ],
        },
      ];
    }
    const calculateNewParams = (prevFactor, prevInterval, delay, signal) => {
      const [newFactor, newInterval] = (() => {
        switch (signal) {
          case "1":
            return [prevFactor - 0.2, 0];
          case "2":
            return [
              prevFactor - config.factorModifier,
              prevInterval * config.hardFactor,
            ];
          case "3":
            return [prevFactor, (prevInterval + delay / 2) * prevFactor];
          case "4":
            return [
              prevFactor + config.factorModifier,
              (prevInterval + delay) * prevFactor * config.easeBonus,
            ];
          default:
            return [prevFactor, prevInterval * prevFactor];
        }
      })();
      return [newFactor, Math.min(newInterval, config.maxInterval)];
    };
    const getDelay = (hist, prevInterval) => {
      if (hist && hist.length > 1) {
        const daysBetweenReview =
          (new Date(hist[hist.length - 1].date) -
            new Date(hist[hist.length - 2].date)) /
          (1000 * 60 * 60 * 24);
        return Math.max(daysBetweenReview - prevInterval, 0);
      }
      return 0;
    };
    const recurAnki = (hist) => {
      if (!hist || hist.length <= config.firstFewIntervals.length) {
        return [
          config.defaultFactor,
          config.firstFewIntervals[config.firstFewIntervals.length - 1],
        ];
      }
      const [prevFactor, prevInterval] = recurAnki(hist.slice(0, -1));
      return calculateNewParams(
        prevFactor,
        prevInterval,
        getDelay(hist, prevInterval),
        hist[hist.length - 1].signal
      );
    };

    const [finalFactor, finalInterval] = recurAnki(history.slice(0, -1));

    const addJitter = (interval) => {
      const jitter = interval * config.jitterPercentage;
      return interval + (-jitter + Math.random() * jitter);
    };

    const getResponse = (signal) => {
      const interval = Math.floor(
        addJitter(
          calculateNewParams(
            finalFactor,
            finalInterval,
            getDelay(history, finalInterval),
            signal[1]
          )
        )
      );
      return {
        responseText: config.responseTexts[parseInt(signal, 10) - 1],
        signal,
        interval,
      };
    };
    return [
      getResponse("1"),
      getResponse("2"),
      getResponse("3"),
      getResponse("4"),
    ];
  };
  return algorithm;
};

// --- Helper functions ---
roamsr.sleep = (m) => new Promise((r) => setTimeout(r, m || 10));

roamsr.createUid = () => {
  // From roam42 based on https://github.com/ai/nanoid#js version 3.1.2
  // eslint-disable-next-line
  const nanoid = (t = 21) => { let e = "", r = crypto.getRandomValues(new Uint8Array(t)); for (; t--;) { let n = 63 & r[t]; e += n < 36 ? n.toString(36) : n < 62 ? (n - 26).toString(36).toUpperCase() : n < 63 ? "_" : "-" } return e };
  return nanoid(9);
};

roamsr.removeSelector = (selector) => {
  document.querySelectorAll(selector).forEach((element) => {
    element.remove();
  });
};

roamsr.goToUid = (uid) => {
  const baseUrl = `/${new URL(window.location.href).hash
    .split("/")
    .slice(0, 3)
    .join("/")}`;
  const url = uid ? `${baseUrl}/page/${uid}` : baseUrl;
  window.location.assign(url);
};

roamsr.getRoamDate = (maybeDate) => {
  const date = maybeDate || new Date();
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const suffix = ((d) => {
    if (d > 3 && d < 21) return "th";
    switch (d % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  })(date.getDate());

  const title = `${
    months[date.getMonth()]
  } ${date.getDate()}${suffix}, ${date.getFullYear()}`;
  const pad = (n) => n.toString().padStart(2, "0");
  const uid = `${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}-${date.getFullYear()}`;
  return [title, uid];
};

roamsr.getIntervalHumanReadable = (n) => {
  if (n === 0) return "<10 min";
  if (n > 0 && n <= 15) return `${n} d`;
  if (n <= 30) return `${(n / 7).toFixed(1)} w`;
  if (n <= 365) return `${(n / 30).toFixed(1)} m`;
  return "";
};

// --- Loading cards and style ---
roamsr.loadCards = async (limits, dateBasis = new Date()) => {
  // Querying for `#sr` and its history and converting to something sensible
  const recur = (part) => {
    const result = [];
    if (part.refs) result.push(...part.refs);
    if (part._children && part._children.length > 0)
      result.push(...recur(part._children[0]));
    return result;
  };
  const mainQuery = `[
    :find (pull ?card [:block/string :block/uid 
    {:block/refs [:node/title]} 
    {:block/_refs [:block/uid :block/string {:block/_children [:block/uid {:block/refs [:node/title]}]} {:block/refs [:node/title]} {:block/page [:block/uid]}]}
    {:block/_children ...}])
    :where [?card :block/refs ?srPage] [?srPage :node/title "${roamsr.settings.mainTag}"] (not-join [?card] [?card :block/refs ?flagPage] [?flagPage :node/title "${roamsr.settings.flagTag}"])]`;
  const mainQueryResult = await window.roamAlphaAPI.q(mainQuery);
  let cards = mainQueryResult.map((result) => ({
    uid: result[0].uid,
    string: result[0].string,
    history: result[0]._refs
      ? result[0]._refs
          .filter((ref) =>
            ref._children[0].refs
              ? ref._children[0].refs
                  .map((ref2) => ref2.title)
                  .includes("roam/sr/review")
              : false
          )
          .map((review) => ({
            date: review.page.uid,
            signal: review.refs[0] ? review.refs[0].title.slice(2) : null,
            uid: review.uid,
            string: review.string,
          }))
          .sort((a, b) => new Date(a.date) - new Date(b.date))
      : [],
    isNew: result[0]._refs
      ? !result[0]._refs.some((review) => {
          const reviewDate = new Date(review.page.uid);
          reviewDate.setDate(reviewDate.getDate() + 1);
          return reviewDate < dateBasis;
        })
      : true,
    decks: recur(result[0]).map((deck) => deck.title),
  }));

  // Query for todays review
  const todayUid = roamsr.getRoamDate()[1];
  const todayQuery = `[
    :find (pull ?card [:block/uid {:block/refs [:node/title]} {:block/_refs [{:block/page [:block/uid]}]}]) (pull ?review [:block/refs])
    :where [?reviewParent :block/children ?review] [?reviewParent :block/page ?todayPage] [?todayPage :block/uid "${todayUid}"] [?reviewParent :block/refs ?reviewPage] [?reviewPage :node/title "roam/sr/review"] [?review :block/refs ?card] [?card :block/refs ?srPage] [?srPage :node/title "${roamsr.settings.mainTag}"]]`;
  const todayQueryResult = await window.roamAlphaAPI.q(todayQuery);
  let todayReviewedCards = todayQueryResult
    .filter((result) => result[1].refs.length === 2)
    .map((result) => ({
      uid: result[0].uid,
      isNew: result[0]._refs
        ? !result[0]._refs.some((review) => {
            const reviewDate = new Date(review.page.uid);
            reviewDate.setDate(reviewDate.getDate() + 1);
            return reviewDate < dateBasis;
          })
        : true,
      decks: recur(result[0]).map((deck) => deck.title),
    }));

  // Filter only cards that are due
  cards = cards.filter((card) =>
    card.history.length > 0
      ? card.history.some(
          (review) => !review.signal && new Date(review.date) <= dateBasis
        )
      : true
  );

  // Detect decks
  cards = cards.map((c) => {
    const card = { ...c };
    card.decks = card.decks.filter((deckTag) =>
      roamsr.settings.customDecks
        .map((customDeck) => customDeck.tag)
        .includes(deckTag)
    );
    return card;
  });

  todayReviewedCards = todayReviewedCards.map((c) => {
    const card = { ...c };
    card.decks = card.decks.filter((deckTag) =>
      roamsr.settings.customDecks
        .map((customDeck) => customDeck.tag)
        .includes(deckTag)
    );
    return card;
  });

  // Save which algorithm
  cards = cards.map((c) => {
    const card = { ...c };
    if (card.decks && card.decks.length > 0) {
      const preferredDeck = roamsr.settings.customDecks.filter(
        (customDeck) => customDeck.tag === card.decks[card.decks.length - 1]
      )[0];
      if (!preferredDeck.algorithm || preferredDeck.algorithm === "anki")
        card.algorithm = roamsr.ankiScheduler(preferredDeck.config);
      else card.algorithm = preferredDeck.algorithm(preferredDeck.config);
    } else if (
      !roamsr.settings.defaultDeck.algorithm ||
      roamsr.settings.defaultDeck.algorithm === "anki"
    )
      card.algorithm = roamsr.ankiScheduler(roamsr.settings.defaultDeck.config);
    else
      card.algorithm = roamsr.settings.defaultDeck.algorithm(
        roamsr.settings.defaultDeck.config
      );
    return card;
  });

  // Filter those that are over limit
  roamsr.state.extraCards = [[], []];
  if (roamsr.state.limits) {
    roamsr.settings.customDecks
      .concat(roamsr.settings.defaultDeck)
      .forEach((deck) => {
        const deckCards = [
          ...new Set(roamsr.fromDeck(todayReviewedCards, deck)),
        ];
        const newDeckCards = roamsr.onlyNew(deckCards);
        const newLimit = deck.newLimit || 0;
        if (newDeckCards.length > newLimit) {
          const extraNewCards = newDeckCards.slice(newLimit);
          extraNewCards.forEach((card) => {
            cards.splice(cards.indexOf(card), 1);
          });
          roamsr.state.extraCards[0].push(extraNewCards);
        }
        const reviewDeckCards = roamsr.onlyReview(deckCards);
        const reviewLimit = deck.reviewLimit || 0;
        if (reviewDeckCards.length > reviewLimit) {
          const extraReviewCards = reviewDeckCards.slice(reviewLimit);
          extraReviewCards.forEach((card) => {
            cards.splice(cards.indexOf(card), 1);
          });
          roamsr.state.extraCards[1].push(extraReviewCards);
        }
      });
  }

  // Order (new to front)
  cards = cards.sort((a, b) => a.history.length - b.history.length);
  return cards;
};

roamsr.fromDeck = (cards, deck) =>
  cards.filter((card) =>
    deck.tag ? card.decks.includes(deck.tag) : card.decks.length === 0
  );
roamsr.onlyNew = (cards) => cards.filter((card) => card.isNew);
roamsr.onlyReview = (cards) => cards.filter((card) => !card.isNew);

// --- Styles ---
roamsr.setCustomStyle = (yes) => {
  const styleId = "roamsr-css-custom";
  const element = document.getElementById(styleId);
  if (element) element.remove();

  if (yes) {
    // Query new style
    const styleQuery = window.roamAlphaAPI.q(`[
      :find (pull ?style [:block/string])
      :where [?roamsr :node/title "roam\/sr"] [?roamsr :block/children ?css] [?css :block/refs ?roamcss] [?roamcss :node/title "roam\/css"] [?css :block/children ?style]]`);

    if (styleQuery && styleQuery.length !== 0) {
      const customStyle = styleQuery[0][0].string
        .replace("```css", "")
        .replace("```", "");

      const roamsrCSS = Object.assign(document.createElement("style"), {
        id: styleId,
        innerHTML: customStyle,
      });

      document.getElementsByTagName("head")[0].appendChild(roamsrCSS);
    }
  }
};

roamsr.addBasicStyles = () => {
  const style = `
  .roamsr-widget__review-button {
    color: #5C7080 !important;
  }
  
  .roamsr-widget__review-button:hover {
    color: #F5F8FA !important;
  }
  
  .roamsr-return-button-container {
    z-index: 100000;
    margin: 5px 0px 5px 45px;
  }
  .roamsr-wrapper {
    position: relative;
    bottom: 180px;
    justify-content: center;
  }
  .roamsr-container {
    z-index: 10000;
    width: 100%;
    max-width: 600px;
    justify-content: center;
    align-items: center;
    padding: 5px 20px;
  }

  .roamsr-response-area {
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 15px;
  }

  .roamsr-flag-button-container {
    width: 100%;
  }
  `;
  const basicStyles = Object.assign(document.createElement("style"), {
    id: "roamsr-css-basic",
    innerHTML: style,
  });
  document.getElementsByTagName("head")[0].appendChild(basicStyles);
};

roamsr.showAnswerAndCloze = (yes) => {
  const styleId = "roamsr-css-mainview";
  const element = document.getElementById(styleId);
  if (element) element.remove();

  if (yes) {
    const style = `
  .roam-article .rm-reference-main,
  .roam-article .rm-block-children
  {
    display: none;  
  }

  .rm-block-ref {
    background-color: #cccccc;
    color: #cccccc;
  }`;

    const basicStyles = Object.assign(document.createElement("style"), {
      id: styleId,
      innerHTML: style,
    });
    document.getElementsByTagName("head")[0].appendChild(basicStyles);
  }
};

// --- Main functions ---
roamsr.scheduleCardIn = async (card, interval) => {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);

  const [nextTitle, nextUid] = roamsr.getRoamDate(nextDate);

  // Create daily note if it doesn't exist yet
  await window.roamAlphaAPI.createPage({
    page: {
      title: nextTitle,
    },
  });

  await roamsr.sleep();

  // Query for the [[roam/sr/review]] block
  const queryReviewBlock = window.roamAlphaAPI.q(
    `
   [:find (pull ?reviewBlock [:block/uid]) :in $ ?dailyNoteUID
   :where [?reviewBlock :block/refs ?reviewPage] [?reviewPage :node/title "roam/sr/review"] [?dailyNote :block/children ?reviewBlock] [?dailyNote :block/uid ?dailyNoteUID]]`,
    nextUid
  );

  // Check if it's there; if not, create it
  let topLevelUid;
  if (queryReviewBlock.length === 0) {
    topLevelUid = roamsr.createUid();
    await window.roamAlphaAPI.createBlock({
      location: {
        "parent-uid": nextUid,
        order: 0,
      },
      block: {
        string: "[[roam/sr/review]]",
        uid: topLevelUid,
      },
    });
    await roamsr.sleep();
  } else {
    topLevelUid = queryReviewBlock[0][0].uid;
  }

  // Generate the block
  const block = {
    uid: roamsr.createUid(),
    string: `((${card.uid}))`,
  };
  // Finally, schedule the card
  await window.roamAlphaAPI.createBlock({
    location: {
      "parent-uid": topLevelUid,
      order: 0,
    },
    block,
  });
  await roamsr.sleep();

  return {
    date: nextUid,
    signal: null,
    uid: block.uid,
    string: block.string,
  };
};

roamsr.flagCard = () => {
  const card = roamsr.getCurrentCard();
  window.roamAlphaAPI.updateBlock({
    block: {
      uid: card.uid,
      string: `${card.string} #${roamsr.settings.flagTag}`,
    },
  });
  const j = roamsr.getCurrentCard().isNew ? 0 : 1;
  roamsr.state.queue.push(roamsr.state.extraCards[j].shift()[0]);
};

roamsr.responseHandler = async (card, interval, signal) => {
  console.log(`Signal: ${signal}, Interval: ${interval}`);
  const hist = card.history;

  // If new card, make it look like it was scheduled for today
  if (
    hist.length === 0 ||
    (hist[hist.length - 1] &&
      new Date(hist[hist.length - 1].date) !== new Date())
  ) {
    const last = hist.pop();
    if (last) {
      await window.roamAlphaAPI.deleteBlock({
        block: {
          uid: last.uid,
        },
      });
    }
    const todayReviewBlock = await roamsr.scheduleCardIn(card, 0);
    hist.push(todayReviewBlock);
  }

  // Record response
  const last = hist[hist.length - 1];
  await window.roamAlphaAPI.updateBlock({
    block: {
      uid: last.uid,
      string: `${last.string} #[[r/${signal}]]`,
    },
  });

  // Schedule card to future
  const nextReview = await roamsr.scheduleCardIn(card, interval);
  hist.push(nextReview);

  // If it's scheduled for today, add it to the end of the queue
  if (interval === 0) {
    const newCard = { ...card };
    newCard.history = hist;
    roamsr.state.queue.push(newCard);
  }
};

roamsr.stepToNext = () => {
  if (roamsr.state.currentIndex + 1 >= roamsr.state.queue.length) {
    roamsr.endSession();
  } else {
    roamsr.state.currentIndex += 1;
    roamsr.goToCurrentCard();
  }
  roamsr.updateCounters();
};

roamsr.goToCurrentCard = async () => {
  window.onhashchange = () => {};
  roamsr.showAnswerAndCloze(true);
  roamsr.removeReturnButton();
  const doStuff = async () => {
    roamsr.goToUid(roamsr.getCurrentCard().uid);
    await roamsr.sleep(50);
    roamsr.addContainer();
    roamsr.addShowAnswerButton();
  };

  await doStuff();
  window.onhashchange = doStuff;

  await roamsr.sleep(200);

  await doStuff();

  window.onhashchange = () => {
    roamsr.removeContainer();
    roamsr.addReturnButton();
    roamsr.showAnswerAndCloze(false);
    window.onhashchange = () => {};
  };
};

// --- Sessions ---
roamsr.loadSettings = () => {
  // Default settings
  roamsr.settings = {
    mainTag: "sr",
    flagTag: "f",
    defaultDeck: {
      algorithm: null,
      config: {},
      newCardLimit: 20,
      reviewLimit: 100,
    },
    customDecks: [],
  };
  roamsr.settings = Object.assign(roamsr.settings, window.roamsrUserSettings);
};

roamsr.loadState = async (i) => {
  roamsr.state = {
    limits: true,
    currentIndex: i,
  };
  roamsr.state.queue = await roamsr.loadCards();
};

roamsr.getCurrentCard = () => {
  const card = roamsr.state.queue[roamsr.state.currentIndex];
  return card || {};
};

roamsr.startSession = async () => {
  if (roamsr.state && roamsr.state.queue.length > 0) {
    console.log("Starting session.");

    roamsr.setCustomStyle(true);

    // Hide left sidebar
    try {
      document.getElementsByClassName("bp3-icon-menu-closed")[0].click();
      // eslint-disable-next-line no-empty
    } catch (e) {}

    roamsr.loadSettings();
    await roamsr.loadState(0);

    console.log("The queue: ");
    console.log(roamsr.state.queue);

    await roamsr.goToCurrentCard();

    roamsr.addKeyListener();

    // Change widget
    const widget = document.querySelector(".roamsr-widget");
    widget.innerHTML =
      "<div style='padding: 5px 0px'><span class='bp3-icon bp3-icon-cross'></span> END SESSION</div>";
    widget.onclick = roamsr.endSession;
  }
};

roamsr.endSession = async () => {
  window.onhashchange = () => {};
  console.log("Ending sesion.");

  // Change widget
  roamsr.removeSelector(".roamsr-widget");
  roamsr.addWidget();

  // Remove elements
  const doStuff = async () => {
    await roamsr.loadState(-1);
    roamsr.removeContainer();
    roamsr.removeReturnButton();
    roamsr.setCustomStyle(false);
    roamsr.showAnswerAndCloze(false);
    roamsr.removeKeyListener();
    roamsr.updateCounters();
    roamsr.goToUid();
  };

  await doStuff();
  await roamsr.sleep(200);
  await doStuff(); // ... again to make sure
};

// --- UI elements ---
// Common
roamsr.getCounter = (deck) => {
  // Getting the number of new cards
  let cardCount = [0, 0];
  if (roamsr.state.queue) {
    const remainingQueue = roamsr.state.queue.slice(
      Math.max(roamsr.state.currentIndex, 0)
    );
    const filteredQueue = !deck
      ? remainingQueue
      : remainingQueue.filter((card) => card.decks.includes(deck));
    cardCount = [
      roamsr.onlyNew(filteredQueue).length,
      roamsr.onlyReview(filteredQueue).length,
    ];
  }

  // Create the element
  const counter = Object.assign(document.createElement("div"), {
    className: "roamsr-counter",
    innerHTML: `<span style="color: dodgerblue; padding-right: 8px">${cardCount[0]}</span> <span style="color: green;">${cardCount[1]}</span>`,
  });
  return counter;
};

roamsr.updateCounters = () => {
  document.querySelectorAll(".roamsr-counter").forEach((counter) => {
    counter.innerHTML = roamsr.getCounter().innerHTML;
    counter.style.cssText = !roamsr.state.limits
      ? "font-style: italic;"
      : "font-style: inherit;";
  });
};

// Container
roamsr.addContainer = () => {
  if (!document.querySelector(".roamsr-container")) {
    const wrapper = Object.assign(document.createElement("div"), {
      className: "flex-h-box roamsr-wrapper",
    });
    const container = Object.assign(document.createElement("div"), {
      className: "flex-v-box roamsr-container",
    });

    const flagButtonContainer = Object.assign(document.createElement("div"), {
      className: "flex-h-box roamsr-flag-button-container",
    });
    const flagButton = Object.assign(document.createElement("button"), {
      className: "bp3-button roamsr-flag-button",
      innerHTML: "Flag.",
      onclick: () => {
        roamsr.flagCard();
        roamsr.stepToNext();
      },
    });
    const skipButton = Object.assign(document.createElement("button"), {
      className: "bp3-button roamsr-skip-button",
      innerHTML: "Skip.",
      onclick: roamsr.stepToNext,
    });
    flagButtonContainer.style.cssText = "justify-content: space-between;";
    flagButtonContainer.append(flagButton, skipButton);

    const responseArea = Object.assign(document.createElement("div"), {
      className: "flex-h-box roamsr-container__response-area",
    });

    container.append(roamsr.getCounter(), responseArea, flagButtonContainer);
    wrapper.append(container);

    const bodyDiv = document.querySelector(".roam-body-main");
    bodyDiv.append(wrapper);
  }
};

roamsr.removeContainer = () => {
  roamsr.removeSelector(".roamsr-wrapper");
};

roamsr.clearAndGetResponseArea = () => {
  const responseArea = document.querySelector(
    ".roamsr-container__response-area"
  );
  if (responseArea) responseArea.innerHTML = "";
  return responseArea;
};

roamsr.addShowAnswerButton = () => {
  const responseArea = roamsr.clearAndGetResponseArea();

  const showAnswerAndClozeButton = Object.assign(
    document.createElement("button"),
    {
      className:
        "bp3-button roamsr-container__response-area__show-answer-button",
      innerHTML: "Show answer.",
      onclick: () => {
        roamsr.showAnswerAndCloze(false);
        roamsr.addResponseButtons();
      },
    }
  );
  showAnswerAndClozeButton.style.cssText = "margin: 5px;";

  responseArea.append(showAnswerAndClozeButton);
};

roamsr.addResponseButtons = () => {
  const responseArea = roamsr.clearAndGetResponseArea();

  // Add new responses
  const responses = roamsr
    .getCurrentCard()
    .algorithm(roamsr.getCurrentCard().history);
  responses.forEach((res) => {
    const responseButton = Object.assign(document.createElement("button"), {
      id: `roamsr-response-${res.signal}`,
      className: "bp3-button roamsr-container__response-area__response-button",
      innerHTML: `${res.responseText}<sup>${roamsr.getIntervalHumanReadable(
        res.interval
      )}</sup>`,
      onclick: () => {
        roamsr.responseHandler(
          roamsr.getCurrentCard(),
          res.interval,
          res.signal
        );
        roamsr.stepToNext();
      },
    });
    responseButton.style.cssText = "margin: 5px;";
    responseArea.append(responseButton);
  });
};

// Return button
roamsr.addReturnButton = () => {
  const returnButtonClass = "roamsr-return-button-container";
  if (document.querySelector(returnButtonClass)) return;

  const main = document.querySelector(".roam-main");
  const body = document.querySelector(".roam-body-main");
  const returnButtonContainer = Object.assign(document.createElement("div"), {
    className: `flex-h-box ${returnButtonClass}`,
  });
  const returnButton = Object.assign(document.createElement("button"), {
    className: "bp3-button bp3-large roamsr-return-button",
    innerText: "Return.",
    onclick: roamsr.goToCurrentCard,
  });
  returnButtonContainer.append(returnButton);
  main.insertBefore(returnButtonContainer, body);
};

roamsr.removeReturnButton = () => {
  roamsr.removeSelector(".roamsr-return-button-container");
};

// Sidebar widget
roamsr.createWidget = () => {
  const widget = Object.assign(document.createElement("div"), {
    className: "log-button flex-h-box roamsr-widget",
  });
  widget.style.cssText =
    "align-items: center; justify-content: space-around; padding-top: 8px;";

  const reviewButton = Object.assign(document.createElement("div"), {
    className: "bp3-button bp3-minimal roamsr-widget__review-button",
    innerHTML: `<span style="padding-right: 8px;"><svg width="16" height="16" version="1.1" viewBox="0 0 4.2333 4.2333" style="color:5c7080;">
  <g id="chat_1_" transform="matrix(.26458 0 0 .26458 115.06 79.526)">
    <g transform="matrix(-.79341 0 0 -.88644 -420.51 -284.7)" fill="currentColor">
      <path d="m6 13.665c-1.1 0-2-1.2299-2-2.7331v-6.8327h-3c-0.55 0-1 0.61495-1 1.3665v10.932c0 0.7516 0.45 1.3665 1 1.3665h9c0.55 0 1-0.61495 1-1.3665l-5.04e-4 -1.5989v-1.1342h-0.8295zm9-13.665h-9c-0.55 0-1 0.61495-1 1.3665v9.5658c0 0.7516 0.45 1.3665 1 1.3665h9c0.55 0 1-0.61495 1-1.3665v-9.5658c0-0.7516-0.45-1.3665-1-1.3665z"
        clip-rule="evenodd" fill="currentColor" fill-rule="evenodd" />
    </g>
  </g></svg></span> REVIEW`,
    //  <span class="bp3-icon bp3-icon-chevron-down expand-icon"></span>`
    onclick: roamsr.startSession,
  });
  reviewButton.style.cssText = "padding: 2px 8px;";

  const counter = Object.assign(roamsr.getCounter(), {
    className: "bp3-button bp3-minimal roamsr-counter",
    onclick: async () => {
      roamsr.state.limits = !roamsr.state.limits;
      roamsr.state.queue = await roamsr.loadCards();
      roamsr.updateCounters();
    },
  });
  const counterContainer = Object.assign(document.createElement("div"), {
    className: "flex-h-box roamsr-widget__counter",
  });
  counterContainer.style.cssText = "justify-content: center; width: 50%";
  counterContainer.append(counter);

  widget.append(reviewButton, counterContainer);

  return widget;
};

roamsr.addWidget = () => {
  if (!document.querySelector(".roamsr-widget")) {
    roamsr.removeSelector(".roamsr-widget-delimiter");
    const delimiter = Object.assign(document.createElement("div"), {
      className: "roamsr-widget-delimiter",
    });
    delimiter.style.cssText =
      "flex: 0 0 1px; background-color: rgb(57, 75, 89); margin: 8px 20px;";

    const widget = roamsr.createWidget();

    const sidebar = document.querySelector(".roam-sidebar-content");
    const starredPages = document.querySelector(".starred-pages-wrapper");

    sidebar.insertBefore(delimiter, starredPages);
    sidebar.insertBefore(widget, starredPages);
  }
};

// --- Keybindings ---
roamsr.processKey = (e) => {
  // console.log("alt: " + e.altKey + "  shift: " + e.shiftKey + "  ctrl: " + e.ctrlKey + "   code: " + e.code + "   key: " + e.key);
  if (
    document.activeElement.type === "textarea" ||
    !window.location.href.includes(roamsr.getCurrentCard().uid)
  ) {
    return;
  }

  const responses = roamsr
    .getCurrentCard()
    .algorithm(roamsr.getCurrentCard().history);
  const handleNthResponse = (n) => {
    if (n > 0 && n < responses.length) {
      const res = responses[n];
      roamsr.responseHandler(roamsr.getCurrentCard(), res.interval, res.signal);
      roamsr.stepToNext();
    }
  };

  // Bindings for 123456789
  if (e.code.includes("Digit")) {
    const n = Math.min(
      parseInt(e.code.replace("Digit", ""), 10) - 1,
      responses.length - 1
    );
    handleNthResponse(n);
    return;
  }

  // Bindings for hjkl
  const letters = ["KeyH", "KeyJ", "KeyK", "KeyL"];
  if (letters.includes(e.code)) {
    const n = Math.min(letters.indexOf(e.code), responses.length - 1);
    handleNthResponse(n);
    return;
  }

  if (e.code === "Space") {
    roamsr.showAnswerAndCloze(false);
    roamsr.addResponseButtons();
    return;
  }

  if (e.code === "KeyF") {
    roamsr.flagCard();
    roamsr.stepToNext();
    return;
  }

  if (e.code === "KeyS") {
    roamsr.stepToNext();
    return;
  }

  if (e.code === "KeyD" && e.altKey) {
    roamsr.endSession();
  }
};

roamsr.addKeyListener = () => {
  document.addEventListener("keydown", roamsr.processKey);
};

roamsr.removeKeyListener = () => {
  document.removeEventListener("keydown", roamsr.processKey);
};

// --- {{sr}} button ---
roamsr.buttonClickHandler = async (e) => {
  if (
    e.target.tagName === "BUTTON" &&
    e.target.textContent === roamsr.settings.mainTag
  ) {
    const block = e.target.closest(".roam-block");
    if (block) {
      const uid = block.id.substring(block.id.length - 9);
      const q = `[:find (pull ?page
                     [{:block/children [:block/uid :block/string]}])
                  :in $ ?uid
                  :where [?page :block/uid ?uid]]`;
      const results = await window.roamAlphaAPI.q(q, uid);
      if (results.length === 0) return;
      const { children } = results[0][0];
      children.forEach((child) => {
        window.roamAlphaAPI.updateBlock({
          block: {
            uid: child.uid,
            string: `${child.string.trim()} #${roamsr.settings.mainTag}`,
          },
        });
      });
    }
  }
};

document.addEventListener("click", roamsr.buttonClickHandler, false);

// --- Creating state, calling functions directly ---
roamsr.loadSettings();
roamsr.addBasicStyles();
roamsr.loadState(-1).then(() => {
  roamsr.addWidget();
});
