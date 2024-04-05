import {
  checkCandidatePrompts,
  getDomain,
  getNextStepFromLLM,
  promptToFirstStep,
  sendMessageToContentScript,
  sendPromptToPlanner,
} from '../utils'
console.log('background is running')

let currentPlan = []
let targetTab = null
let currentStep = 0
let originalPrompt = ''
let currentURL = ''
let allowedTabs = new Set()

const navURL = (url) => {
  console.log(url, 'url')
  currentURL = url
  //Needs http otherwise does not go to absolute URL
  if (url.indexOf('http') !== 0) {
    url = 'http://' + url
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: url }, (tab) => {
      if (chrome.runtime.lastError) {
        // If there's an error during tab creation, reject the promise
        reject(new Error(chrome.runtime.lastError))
      } else {
        allowedTabs.add(tab.id) //allowed tabs enables content script
        targetTab = tab.id // Store the tab ID for later use
        resolve(tab) // Resolve the promise with the tab object
      }
    })
  })
}

// const retryTask = () => {
//   const messagePayload = {
//     currentStep: currentStep - 1,
//     originalPlan: currentPlan,
//     originalPrompt,
//   }
//   sendMessageToTab(targetTab, messagePayload)
// }

const completedTask = () => {
  console.log('inside completed task')
  console.log(targetTab, 'targetTab')
  console.log(currentPlan[currentStep], 'currentPlan[currentStep]')
  if (currentStep >= currentPlan.length) {
    console.log('plan complete.')
    return
  }
  currentStep++
  const messagePayload = {
    currentStep: currentStep - 1,
    originalPlan: currentPlan,
    originalPrompt,
  }
  sendMessageToTab(targetTab, messagePayload)
}

const addStepToPlan = (step) => {
  currentPlan.push(step)
  executeCurrentStep()
}

const executeCurrentStep = async () => {
  console.log('inside execute current step')
  if (currentPlan[currentStep].action === 'NAVURL') {
    // if the action is NAVURL
    await navURL(currentPlan[currentStep].param)
  } else if (currentPlan[currentStep].action === 'CLICK') {
    // if the action is CLICK
    clickElement(targetTab, currentPlan[currentStep].param)
  } else if (currentPlan[currentStep].action === 'ASKUSER') {
    // if the action is ASKUSER
    // TODO: Handle ASKUSER
  }
  currentStep++
  getNextStep()
}

const getNextStep = () => {
  console.log('inside next step ting')
  // Check if the tab is completely loaded before sending a message
  console.log(targetTab, 'targetTab')
  checkTabReady(targetTab, async function () {
    console.log('made it')
    const messagePayload = {
      type: 'generateNextStep',
      currentStep: currentStep - 1,
      originalPlan: currentPlan,
      originalPrompt,
    }
    await sendMessageToTab(targetTab, messagePayload)
  })
}

chrome.runtime.onMessage.addListener(async (request) => {
  // make an event in my google calendar on friday 12pm labeled "hello world"
  if (request.type === 'new_plan') {
    console.log('new plan received')
    currentPlan = request.data.plan
    currentStep = 1
    const messagePayload = {
      currentStep: 0,
      originalPlan: currentPlan,
      originalPrompt,
    }
    sendMessageToTab(targetTab, messagePayload)
  } else if (request.type === 'nav_url') {
    navURL(request.url)
  } else if (request.type === 'completed_task') {
    completedTask()
  } else if (request.type === 'new_goal') {
    currentStep = 0
    currentPlan = []
    originalPrompt = request.prompt
    const responseJSON = await promptToFirstStep(request.prompt)
    responseJSON.action = 'NAVURL' // Hard coded for now
    addStepToPlan(responseJSON)
  } else if (request.type === 'click_element') {
    clickElement(targetTab, request.selector)
  } else if (request.type === 'next_step') {
    getNextStepFromLLM(currentURL, currentPlan, currentStep, request.clickableElementLabels)
  }
  return true
})

async function sendMessageToTab(tabId, message) {
  let retries = 3
  while (retries > 0) {
    try {
      const response = await new Promise((resolve, reject) => {
        console.log('sending message')
        chrome.tabs.sendMessage(tabId, message, function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            resolve(response)
          }
        })
      })
      console.log('Received response:', response)
      return
    } catch (error) {
      console.error('Error in sending message:', error)
      retries--
      if (retries === 0) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait a bit before retrying
    }
  }
}

function checkTabReady(tabId, callback) {
  console.log('waiting tab ready...')
  chrome.tabs.onUpdated.addListener(function listener(tabIdUpdated, changeInfo, tab) {
    if (tabIdUpdated === tabId && changeInfo.status === 'complete') {
      // Remove the listener after we found the right tab and it has finished loading
      chrome.tabs.onUpdated.removeListener(listener)
      callback(tab)
    }
  })
}
async function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.2', () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      } else {
        resolve()
      }
    })
  })
}

async function getDocumentRoot(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument', {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      } else {
        resolve(result.root)
      }
    })
  })
}

async function querySelectorNode(tabId, root, selector) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      { tabId },
      'DOM.querySelector',
      { nodeId: root.nodeId, selector },
      (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message)
        } else {
          resolve(result.nodeId)
        }
      },
    )
  })
}

async function getBoxModelForNode(tabId, nodeId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, 'DOM.getBoxModel', { nodeId }, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      } else {
        resolve(result.model)
      }
    })
  })
}

async function dispatchMouseEvent(tabId, type, x, y, button, clickCount) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      { tabId },
      'Input.dispatchMouseEvent',
      {
        type,
        x,
        y,
        button,
        clickCount,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message)
        } else {
          resolve()
        }
      },
    )
  })
}

async function callElementClick(tabId, nodeId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, 'DOM.resolveNode', { nodeId }, ({ object }) => {
      chrome.debugger.sendCommand(
        { tabId },
        'Runtime.callFunctionOn',
        {
          functionDeclaration: 'function() { this.click(); }',
          objectId: object.objectId,
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError.message)
          } else {
            resolve()
          }
        },
      )
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function clickElementAt(tabId, x, y) {
  await dispatchMouseEvent(tabId, 'mousePressed', x, y, 'left', 1)
  await dispatchMouseEvent(tabId, 'mouseReleased', x, y, 'left', 1)
  const messagePayload = {
    type: 'showClick',
    x,
    y,
  }
  sendMessageToTab(targetTab, messagePayload)
}

async function clickElement(tabId, selector) {
  try {
    console.log(selector, 'selector')
    await attachDebugger(tabId)
    const root = await getDocumentRoot(tabId)
    const nodeId = await querySelectorNode(tabId, root, selector)
    const model = await getBoxModelForNode(tabId, nodeId)
    const { content } = model
    const x = (content[0] + content[2]) / 2
    const y = (content[1] + content[5]) / 2

    // await callElementClick(tabId, nodeId)
    await clickElementAt(tabId, x, y)
    chrome.debugger.detach({ tabId })
    await sleep(2000)
    completedTask()
  } catch (e) {
    console.log(e, 'e')
  }
}

// --- We only allow content script to execute on tabs created by background script
// Listen for when a tab is closed and remove it from the set
chrome.tabs.onRemoved.addListener(function (tabId) {
  allowedTabs.delete(tabId)
})
//Used for ContentScript to see if its on a tab it can execute on
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'checkTab') {
    console.log(allowedTabs, sender.tab.id, 'allowedTabs')
    const isAllowed = allowedTabs.has(sender.tab.id)
    sendResponse({ isAllowed: isAllowed })
  }
})
