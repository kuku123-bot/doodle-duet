// Ideas for the Challenge and Guess modes.
export const PROMPTS = [
  'a cat wearing a tiny hat', 'our dream house', 'a dragon eating noodles', 'you as a superhero', 'a snail on a skateboard',
  'a cozy rainy window', 'a robot in love', 'a bear having a picnic', 'the moon drinking tea', 'a penguin on holiday',
  'a magical tree house', 'a frog prince', 'breakfast in bed', 'a whale in the sky', 'a cactus that hugs',
  'our first date', 'a bunny astronaut', 'a sleepy fox', 'a castle made of cake', 'a dog driving a car',
  'a mermaid with a cell phone', 'a lighthouse at night', 'an octopus chef', 'a hot air balloon trip', 'a ghost who is shy',
  'a fruit with a face', 'a dinosaur at school', 'the perfect sandwich', 'a flower in a teacup', 'a jellyfish party',
  'a monster under the bed (friendly)', 'a picnic on a cloud', 'a koala DJ', 'a cat café', 'a boat in a bottle',
  'a tiny village in a mushroom', 'a sunflower field', 'a unicorn doing yoga', 'a city on a turtle\'s back', 'a robot gardener',
  'your favourite food as a character', 'a cozy bookshop', 'a camping night with stars', 'a duck in rain boots', 'a sloth on a rollercoaster',
  'a snowman at the beach', 'a love letter delivered by a bird', 'a pizza planet', 'a sleepy moon', 'a hedgehog with balloons',
  'a cozy blanket fort', 'a pirate cat', 'a train through the mountains', 'a garden of candy', 'a bee wearing glasses',
  'our pets as royalty', 'a tea party for bugs', 'a treasure map', 'a volcano that makes popcorn', 'a hug between two clouds',
];
export const WORDS = [
  'cat', 'dog', 'house', 'tree', 'sun', 'moon', 'star', 'car', 'boat', 'fish', 'bird', 'flower', 'heart', 'cake', 'pizza', 'apple',
  'banana', 'umbrella', 'rainbow', 'cloud', 'rocket', 'robot', 'ghost', 'crown', 'castle', 'bridge', 'snowman', 'penguin', 'rabbit',
  'turtle', 'snail', 'butterfly', 'spider', 'elephant', 'giraffe', 'lion', 'monkey', 'owl', 'frog', 'whale', 'octopus', 'dragon',
  'unicorn', 'mermaid', 'pirate', 'guitar', 'piano', 'drum', 'camera', 'phone', 'lamp', 'chair', 'bed', 'clock', 'key', 'glasses',
  'hat', 'shoe', 'sock', 'shirt', 'balloon', 'kite', 'bicycle', 'train', 'airplane', 'helicopter', 'tractor', 'bus', 'candle', 'gift',
  'ice cream', 'donut', 'cookie', 'carrot', 'mushroom', 'cactus', 'volcano', 'mountain', 'island', 'beach', 'tent', 'campfire',
  'lighthouse', 'windmill', 'anchor', 'sword', 'shield', 'wand', 'teapot', 'cup', 'spoon', 'fork', 'bottle', 'book', 'pencil',
  'scissors', 'backpack', 'umbrella', 'ladder', 'door', 'window', 'fence', 'flag', 'medal', 'trophy', 'bell', 'magnet', 'bone',
  'tooth', 'eye', 'hand', 'foot', 'nose', 'ear', 'smile', 'kiss', 'hug', 'sleep', 'dance', 'swim', 'jump', 'rain', 'snow', 'wind',
  'lightning', 'tornado', 'wave', 'shell', 'crab', 'shark', 'dolphin', 'bee', 'ladybug', 'worm', 'bat', 'pumpkin', 'witch', 'angel',
  'alien', 'planet', 'telescope', 'compass', 'map', 'treasure', 'diamond', 'ring', 'necklace', 'popcorn', 'hamburger', 'sandwich',
  'egg', 'cheese', 'grapes', 'cherry', 'watermelon', 'strawberry', 'lemon', 'pineapple', 'avocado', 'coffee', 'tea', 'sushi',
];
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
