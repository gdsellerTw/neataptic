/* Export */
if (module) module.exports = Network;

/* Import */
var Node       = require('./node');
var Connection = require('./connection');
var Methods    = require('./methods/methods');
var Config     = require('./config');
var Neat       = require('./neat');

/* Easier variable naming */
var Activation = Methods.Activation;
var Mutation   = Methods.Mutation;

/*******************************************************************************************
                                         NETWORK
*******************************************************************************************/

function Network(input, output){
  if(typeof input == 'undefined' || typeof output == 'undefined'){
    throw new Error('No input or output size given');
  }

  this.input = input;
  this.output = output;

  // Store all the node and connection genes
  this.nodes = []; // Stored in activation order
  this.connections = [];
  this.gates = [];
  this.selfconns = [];

  // Regularization
  this.dropout = 0;

  // Create input and output nodes
  for(var i = 0; i < this.input + this.output; i++){
    var type = (i < this.input) ? 'input' : 'output';
    this.nodes.push(new Node(type, this.nodes.length));
  }

  // Connect input nodes with output nodes directly
  for(var i = 0; i < this.input; i++){
    for(var j = this.input; j < this.output + this.input; j++){
      this.connect(this.nodes[i], this.nodes[j]);
    }
  }
}

Network.prototype = {
  /**
   * Activates the network
   */
  activate: function(input, training){
    var output = [];
    // Activate nodes chronologically
    for(node in this.nodes){
      if(this.nodes[node].type == 'input'){
        this.nodes[node].activate(input[node]);
      } else if (this.nodes[node].type == 'output'){
        var activation = this.nodes[node].activate();
        output.push(activation);
      } else {
        if(training) this.nodes[node].mask = Math.random() < this.dropout ? 0 : 1;
        this.nodes[node].activate();
      }
    }
    return output;
  },

  /**
   * Backpropagate the network
   */
  propagate: function(rate, target){
    this.nodes.reverse();
    target.reverse();

    // Propagate nodes from end to start
    for(node in this.nodes){
      switch(this.nodes[node].type){
        case('hidden'):
          this.nodes[node].propagate(rate);
          break;
        case('output'):
          this.nodes[node].propagate(rate, target[node]);
          break;
      }
    }

    target.reverse();
    this.nodes.reverse();
  },

  /**
   * Clear the context of the network
   */
  clear: function(){
    for(var node in this.nodes){
      this.nodes[node].clear();
    }
  },

  /**
   * Connects the from node to the to node
   */
  connect: function(from, to){
    var connections = from.connect(to);

    for(var connection in connections){
      connection = connections[connection];
      if(from != to){
        this.connections.push(connection);
      } else {
        this.selfconns.push(connection);
      }
    }

    return connections;
  },

  /**
   * Disconnects the from node from the to node
   */
  disconnect: function(from, to){
    // Delete the connection in the network's connection array
    var connections = from == to ? this.selfconns : this.connections;

    for(conn in connections){
      var connection = connections[conn];
      if(connection.from == from && connection.to == to){
        if(connection.gater != null) this.ungate(connection);
        connections.splice(conn, 1);
        break;
      }
    }

    // Delete the connection at the sending and receiving neuron
    from.disconnect(to);
  },

  /**
   * Gate a connection with a node
   */
  gate: function(node, connection){
    if(this.nodes.indexOf(node) == -1){
      throw new Error('This node is not part of the network!');
    } else if (connection.gater != null){
      if(Config.warnings) console.warn('This connection is already gated!');
      return;
    }
    node.gate(connection);
    this.gates.push(connection);
  },

 /**
  *  Remove the gate of a connection
  */
  ungate: function(connection){
    var index = this.gates.indexOf(connection);
    if(index == -1){
      throw new Error('This connection is not gated!');
    }

    this.gates.splice(index, 1);
    connection.gater.ungate(connection);
  },

  /**
   *  Removes a node from the network
   */
  remove: function(node){
    var index = this.nodes.indexOf(node);

    if(index == -1){
      throw new Error('This node does not exist in the network!');
    }

    // Keep track of gaters
    var gaters = [];

    // Get all its inputting nodes
    var inputs = [];
    for(var i = node.connections.in.length - 1; i >= 0; i--){
      var connection = node.connections.in[i];
      if(Methods.Mutation.SUB_NODE.keep_gates && connection.gater != null && connection.gater != node){
        gaters.push(connection.gater);
      }
      inputs.push(connection.from);
      this.disconnect(connection.from, node);
    }

    // Get all its outputing nodes
    var outputs = [];
    for(var i = node.connections.out.length - 1; i >= 0; i--){
      var connection = node.connections.out[i];
      if(Methods.Mutation.SUB_NODE.keep_gates && connection.gater != null && connection.gater != node){
        gaters.push(connection.gater);
      }
      outputs.push(connection.to);
      this.disconnect(node, connection.to);
    }

    // Connect the input nodes to the output nodes (if not already connected)
    var connections = [];
    for(var input in inputs){
      input = inputs[input];
      for(var output in outputs){
        output = outputs[output];
        if(!input.isProjectingTo(output)){
          var conn = this.connect(input, output);
          connections.push(conn[0]);
        }
      }
    }

    // Gate random connections with gaters
    for(var gater in gaters){
      if(connections.length == 0) break;
      gater = gaters[gater];

      var connIndex = Math.floor(Math.random() * connections.length);
      var conn = connections[connIndex];

      this.gate(gater, connections[connIndex]);
      connections.splice(connIndex, 1);
    }

    // Remove gated connections gated by this node
    for(var i = node.connections.gated.length - 1; i >= 0 ; i--){
      var conn = node.connections.gated[i];
      this.ungate(conn);
    }

    // Remove selfconnection
    this.disconnect(node, node);

    // Remove the node from this.nodes
    this.nodes.splice(index, 1);
  },

  /**
   * Mutates the network with the given method
   */
  mutate: function(method){
    if(typeof method == 'undefined'){
      throw new Error('No (correct) mutate method given!');
    }

    switch(method){
      case Mutation.ADD_NODE:
        // Look for an existing connection and place a node in between
        var connection = this.connections[Math.floor(Math.random() * this.connections.length)];
        var gater = connection.gater;
        this.disconnect(connection.from, connection.to);

        // Insert the new node right before the old connection.to
        var toIndex = this.nodes.indexOf(connection.to);
        var node = new Node('hidden', this.nodes.length);

        // Random squash function
        node.mutate(Mutation.MOD_ACTIVATION);

        // Place it in this.nodes
        var minBound = Math.min(toIndex, this.nodes.length - this.output);
        this.nodes.splice(minBound, 0, node);

        // Now create two new connections
        var newConn1 = this.connect(connection.from, node)[0];
        var newConn2 = this.connect(node, connection.to)[0];

        // Check if the original connection was gated
        if(gater != null){
          this.gate(gater, Math.random() >= 0.5 ? newConn1 : newConn2);
        }
        break;
      case Mutation.SUB_NODE:
        // Check if there are nodes left to remove
        if(this.nodes.length == this.input + this.output){
          if(Config.warnings) console.warn('No more nodes left to remove!');
          break;
        }

        // Select a node which isn't an input or output node
        var index = Math.floor(Math.random() * (this.nodes.length - this.output - this.input) + this.input);
        this.remove(this.nodes[index]);
        break;
      case Mutation.ADD_CONN:
        // Create an array of all uncreated (feedforward) connections
        var available = [];
        for(var i = 0; i < this.nodes.length - this.output; i++){
          var node1 = this.nodes[i];
          for(var j = Math.max(i + 1, this.input); j < this.nodes.length; j++){
            var node2 = this.nodes[j];
            if(!node1.isProjectingTo(node2)) available.push([node1, node2]);
          }
        }

        if(available.length == 0){
          if(Config.warnings) console.warn('No more connections to be made!');
          break;
        }

        var pair = available[Math.floor(Math.random() * available.length)];
        this.connect(pair[0], pair[1]);
        break;
      case Mutation.SUB_CONN:
        // List of possible connections that can be removed
        var possible = [];

        for(conn in this.connections){
          conn = this.connections[conn];
          // Check if it is not disabling a node
          if(conn.from.connections.out.length > 1 && conn.to.connections.in.length > 1 && this.nodes.indexOf(conn.to) > this.nodes.indexOf(conn.from)){
            possible.push(conn);
          }
        }

        if(possible.length == 0){
          if(Config.warnings) console.warn('No connections to remove!');
          break;
        }

        var randomConn = possible[Math.floor(Math.random() * possible.length)];
        this.disconnect(randomConn.from, randomConn.to);
        break;
      case Mutation.MOD_WEIGHT:
        var connection = this.connections[Math.floor(Math.random() * this.connections.length)];
        var modification = Math.random() * (method.max - method.min) + method.min;
        connection.weight += modification;
        break;
      case Mutation.MOD_BIAS:
        // Has no effect on input node, so they are excluded
        var index = Math.floor(Math.random() * (this.nodes.length - this.input) + this.input);
        var node = this.nodes[index];
        node.mutate(method);
        break;
      case Mutation.MOD_ACTIVATION:
        // Has no effect on input node, so they are excluded
        if(!method.mutateOutput && this.input + this.output == this.nodes.length){
          if(Config.warnings) console.warn('No nodes that allow mutation of activation function');
          break;
        }

        var index = Math.floor(Math.random() * (this.nodes.length - (method.mutateOutput ? 0 : this.output) - this.input) + this.input);
        var node = this.nodes[index];

        node.mutate(method);
        break;
      case Mutation.ADD_SELF_CONN:
        // Check which nodes aren't selfconnected yet
        var possible = [];
        for(var i = this.input; i < this.nodes.length; i++){
          var node = this.nodes[i];
          if(node.connections.self.weight == 0){
            possible.push(node);
          }
        }

        if(possible.length == 0){
          if(Config.warnings) console.warn('No more self-connections to add!');
          break;
        }

        // Select a random node
        var node = possible[Math.floor(Math.random() * possible.length)];

        // Connect it to himself
        this.connect(node, node);
        break;
      case Mutation.SUB_SELF_CONN:
        if(this.selfconns.length == 0){
          if(Config.warnings) console.warn('No more self-connections to remove!');
          break;
        }
        var conn = this.selfconns[Math.floor(Math.random() * this.selfconns.length)];
        this.disconnect(conn.from, conn.to);
        break;
      case Mutation.ADD_GATE:
        var allconnections = this.connections.concat(this.selfconns);

        // Create a list of all non-gated connections
        var possible = [];
        for(var conn in allconnections){
          conn = allconnections[conn];
          if(conn.gater == null){
            possible.push(conn);
          }
        }

        if(possible.length == 0){
          if(Config.warnings) console.warn('No more connections to gate!');
          break;
        }

        // Select a random gater node and connection
        var node = this.nodes[Math.floor(Math.random() * this.nodes.length)];
        var conn = possible[Math.floor(Math.random() * possible.length)];

        // Gate the connection with the node
        this.gate(node, conn);
        break;
      case Mutation.SUB_GATE:
        // Select a random gated connection
        if(this.gates.length == 0){
          if(Config.warnings) console.warn('No more connections to ungate!');
          break;
        }

        var index = Math.floor(Math.random() * this.gates.length);
        var gatedconn = this.gates[index];

        this.ungate(gatedconn);
        break;
      case Mutation.ADD_BACK_CONN:
        // Create an array of all uncreated (backfed) connections
        var available = [];
        for(var i = this.input; i < this.nodes.length; i++){
          var node1 = this.nodes[i];
          for(var j = this.input; j < i; j++){
            var node2 = this.nodes[j];
            if(!node1.isProjectingTo(node2)) available.push([node1, node2]);
          }
        }

        if(available.length == 0){
          if(Config.warnings) console.warn('No more connections to be made!');
          break;
        }

        var pair = available[Math.floor(Math.random() * available.length)];
        this.connect(pair[0], pair[1]);
        break;
      case Mutation.SUB_BACK_CONN:
        // List of possible connections that can be removed
        var possible = [];

        for(conn in this.connections){
          conn = this.connections[conn];
          // Check if it is not disabling a node
          if(conn.from.connections.out.length > 1 && conn.to.connections.in.length > 1 && this.nodes.indexOf(conn.from) > this.nodes.indexOf(conn.to)){
            possible.push(conn);
          }
        }

        if(possible.length == 0){
          if(Config.warnings) console.warn('No connections to remove!');
          break;
        }

        var randomConn = possible[Math.floor(Math.random() * possible.length)];
        this.disconnect(randomConn.from, randomConn.to);
        break;
      case Mutation.SWAP_NODES:
        // Input nodes are excluded
        var index = Math.floor(Math.random() * (this.nodes.length - this.input) + this.input);
        var node1 = this.nodes[index];
        var index = Math.floor(Math.random() * (this.nodes.length - this.input) + this.input);
        var node2 = this.nodes[index];

        var biasTemp = node1.bias;
        var squashTemp = node1.squash;

        node1.bias = node2.bias;
        node1.squash = node2.squash;
        node2.bias = biasTemp;
        node2.squash = squashTemp;
        break;
    }
  },

  /**
   * Train the given set to this network
   */
  train: function(set, options) {
    options = options || {};

    // Warning messages
    if(typeof options.rate == 'undefined'){
      if(Config.warnings) console.warn('Using default learning rate, please define a rate!')
    }

    if(typeof options.iterations == "undefined"){
      if(Config.warnings) console.warn('No target iterations given, running until error is reached!')
    }

    var start = Date.now();

    // Configure given options
    var log           = options.log           || false;
    var targetError   = options.error         || 0.005;
    var cost          = options.cost          || Methods.Cost.MSE;
    var rate          = options.rate          || 0.3;
    var shuffle       = options.shuffle       || false;
    var iterations    = options.iterations    || 0;
    var crossValidate = options.crossValidate || false;
    var clear         = options.clear         || false;
    var dropout       = options.dropout       || 0;
    var schedule      = options.schedule;

    // Save to network
    this.dropout = dropout;

    if(crossValidate){
      var testSize = options.crossValidate.testSize;
      var testError = options.crossValidate.testError;
      var numTrain = Math.ceil((1 - testSize) * set.length);
      var trainSet = set.slice(0, numTrain);
      var testSet = set.slice(numTrain);
    }

    var currentRate = rate;

    // Splits the given rates, assigns it to chunks of iteration
    var bucketSize = 0;
    if(Array.isArray(rate)){
      bucketSize = Math.floor(iterations / rate.length);
    }

    // Loops the training process
    var iteration = 0;
    var error = 1;

    while (error > targetError && ( iterations == 0 || iteration < iterations)) {
      if (crossValidate && error <= testError) break;

      iteration++;

      // If the rate is a function, calculate the new rate
      if(typeof rate === 'function'){
        currentRate = rate(iterations, error);
      }

      error = 0;

      // Changes the rate depending on the iteration (if enabled)
      if(bucketSize > 0) {
        var currentBucket = Math.floor(iterations / bucketSize);
        currentRate = rate[currentBucket] || currentRate;
      }

      // Checks if cross validation is enabled
      if (crossValidate) {
        this._trainSet(trainSet, currentRate, cost);
        if(clear) this.clear();
        error += this.test(testSet, cost).error;
        if(clear) this.clear();
      } else {
        error += this._trainSet(set, currentRate, cost);
        if(clear) this.clear();
        error /= set.length;
      }

      // Checks for options such as scheduled logs and shuffling
      if(shuffle){
        for (var j, x, i = set.length; i; j = Math.floor(Math.random() * i), x = set[--i], set[i] = set[j], set[j] = x);
      }

      if(log && iteration % log == 0){
        console.log('iteration', iteration, 'error', error, 'rate', currentRate);
      }

      if(schedule && iteration % schedule.iterations == 0){
        schedule.function();
      }
    }

    if(clear) this.clear();

    if(dropout){
      for(var i = 0; i < this.nodes.length; i++){
        if(this.nodes[i].type == 'hidden' || this.nodes[i].type == 'constant'){
          this.nodes[i].mask = 1 - this.dropout;
        }
      }
    }

    // Creates an object of the results
    var results = {
      error: error,
      iterations: iteration,
      time: Date.now() - start
    };

    return results;
  },

  /**
   * Performs one training epoch and returns the error
   * private function used in this.train
   */
  _trainSet: function(set, currentRate, costFunction) {
    var errorSum = 0;
    for (var train in set) {
      var input = set[train].input;
      var target = set[train].output;

      var output = this.activate(input, true);
      this.propagate(currentRate, target);

      errorSum += costFunction(target, output);
    }
    return errorSum;
  },

  /**
   * Tests a set and returns the error and elapsed time
   */
  test: function(set, cost) {
    cost = cost || Methods.Cost.MSE;
    var error = 0;
    var input, output, target;

    var start = Date.now();

    for (var test in set) {
      input = set[test].input;
      target = set[test].output;
      output = this.activate(input);
      error += cost(target, output);
    }

    error /= set.length;

    var results = {
      error: error,
      time: Date.now() - start
    };

    return results;
  },

  /**
   * Creates a json that can be used to create a graph with d3 and webcola
   */
   graph: function(width, height){
     var input = 0;
     var output = 0;

     var json = {
       nodes : [],
       links : [],
       constraints : [
         { type:"alignment", axis:"x", offsets:[] },
         { type:"alignment", axis:"y", offsets:[] }
       ]
     };

     for(index in this.nodes){
       var node = this.nodes[index];

       if(node.type == 'input'){
         if(this.input == 1){
           json.constraints[0].offsets.push({node:index, offset: 0});
         } else {
           json.constraints[0].offsets.push({node:index, offset : 0.8 * width / (this.input-1) * input++});
         }
         json.constraints[1].offsets.push({node:index, offset : 0});
       } else if (node.type == 'output'){
         if(this.output == 1){
           json.constraints[0].offsets.push({node:index, offset: 0});
         } else {
           json.constraints[0].offsets.push({node:index, offset : 0.8 * width / (this.output-1) * output++});
         }
         json.constraints[1].offsets.push({node:index, offset : -0.8 * height});
       }

       json.nodes.push({
         id: index,
         name: node.type == 'hidden' ? node.squash.name : node.type.toUpperCase(),
         activation : node.activation,
         bias: node.bias
       });
     }

     var connections = this.connections.concat(this.selfconns);
     for(connection in connections){
       connection = connections[connection];
       if(connection.gater == null){
         json.links.push({
           source : this.nodes.indexOf(connection.from),
           target : this.nodes.indexOf(connection.to),
           weight : connection.weight
         });
       } else {
         // Add a gater 'node'
         var index = json.nodes.length;
         json.nodes.push({
           id: index,
           activation: connection.gater.activation,
           name: 'GATE'
         });
         json.links.push({
           source: this.nodes.indexOf(connection.from),
           target: index,
           weight: 1/2 * connection.weight
         });
         json.links.push({
           source: index,
           target: this.nodes.indexOf(connection.to),
           weight: 1/2 * connection.weight
         });
         json.links.push({
           source: this.nodes.indexOf(connection.gater),
           target: index,
           weight: connection.gater.activation,
           gate: true
         });
       }
     }

     return json;
   },

   /**
    * Convert the network to a json object
    */
    toJSON: function(){
      var json = {
        nodes : [],
        connections : [],
        input : this.input,
        output : this.output,
        dropout: this.dropout
      };

      for(index in this.nodes){
        var node = this.nodes[index];
        var tojson = node.toJSON();
        tojson.index = index;
        json.nodes.push(tojson);

        if(node.connections.self.weight != 0){
          var tojson = node.connections.self.toJSON();
          tojson.from = index;
          tojson.to = index;

          tojson.gater = node.connections.self.gater != null ? this.nodes.indexOf(node.connections.self.gater) : null;
          json.connections.push(tojson);
        }
      }

      for(conn in this.connections){
        var conn = this.connections[conn];
        var tojson = conn.toJSON();
        tojson.from = this.nodes.indexOf(conn.from);
        tojson.to = this.nodes.indexOf(conn.to);

        tojson.gater = conn.gater != null ? this.nodes.indexOf(conn.gater) : null;

        json.connections.push(tojson);
      }


      return json;
    },

  /**
   * Sets the value of a property for every node in this network
   */
    set: function(values){
      for(var node in this.nodes){
        this.nodes[node].bias = values.bias || this.nodes[node].bias;
        this.nodes[node].squash = values.squash || this.nodes[node].squash;
      }
    },

  /**
   * Evolves the network to reach a lower error on a dataset
   */
   evolve: function(set, options){
     var cost = options.cost             || Methods.Cost.MSE;
     var amount = options.amount         || 1;
     var growth = typeof options.growth !== 'undefined' ? options.growth : 0.0001;
     var iterations = options.iterations || 0;
     var targetError = options.error     || 0.005;
     var log = options.log               || 0;
     var clear = options.clear           || false;
     var schedule = options.schedule;

     var start = Date.now();

     function fitness(genome){
       var score = 0;
       for(var i = 0; i < amount; i++){
         if(clear) genome.clear();
         score -= genome.test(set, cost).error;
       }

       score -= (genome.nodes.length + genome.connections.length + genome.gates.length) * growth;

       score = isNaN(score) ? -Infinity : score;
       return score/amount;
     }

     options.network = this;
     var neat = new Neat(0,0, fitness, options);

     var error = -Infinity;
     var bestError = -Infinity;
     var bestGenome = null;

     while(error < -targetError && (iterations == 0 || neat.generation < iterations)){
       neat.evolve();
       var fittest = neat.getFittest();

       if(clear) fittest.clear();
       error = -fittest.test(set).error - (fittest.nodes.length + fittest.connections.length + fittest.gates.length) * growth;

       if(error > bestError){
         bestError = error;
         bestGenome = fittest;
       }

       if(log && neat.generation % log == 0){
         console.log('generation', neat.generation, 'error', fittest.score, 'cost error', error);
       }

       if(schedule && iteration % schedule.iterations == 0){
         schedule.function();
       }
     }

     if(clear) bestGenome.clear();

     var results = {
       error: error,
       generations: neat.generation,
       time: Date.now() - start
     };

     this.nodes = bestGenome.nodes;
     this.connections = bestGenome.connections;
     this.gates = bestGenome.gates;
     this.selfconns = bestGenome.selfconns;

     return results;
   },
};

/**
 * Convert a json object to a network
 */
 Network.fromJSON = function(json){
   var network = new Network(json.input, json.output);
   network.dropout = json.dropout;
   network.nodes = [];
   network.connections = [];

   for(node in json.nodes){
     network.nodes.push(Node.fromJSON(json.nodes[node]));
   }

   for(conn in json.connections){
     var conn = json.connections[conn];

     var connection = network.connect(network.nodes[conn.from], network.nodes[conn.to])[0];
     connection.weight = conn.weight;

     if(conn.gater != null){
       network.gate(network.nodes[conn.gater], connection);
     }
   }

   return network;
 }

 /**
  * Merge two networks into one
  */
 Network.merge = function(network1, network2){
   // Create a copy of the networks
   network1 = Network.fromJSON(network1.toJSON());
   network2 = Network.fromJSON(network2.toJSON());

   // Check if output and input size are the same
   if(network1.output != network2.input){
     throw new Error('Output size of network1 should be the same as the input size of network2!');
   }

   // Redirect all connections from network2 input to network1 output
   for(conn in network2.connections){
     conn = network2.connections[conn];
     if(conn.from.type == 'input'){
       var index = network2.nodes.indexOf(conn.from);
       var node = network2.nodes[index];

       // redirect
       conn.from = network1.nodes[network1.nodes.length - 1 - index];
     }
   }

   // Change the node type of network1's output nodes (now hidden)
   for(var i = network1.nodes.length - 1 - network1.output; i < network1.nodes.length; i++){
     network1.nodes[i].type = 'hidden';
   }

   // Create one network of both networks
   network1.connections = network1.connections.concat(network2.connections);
   network1.nodes = network1.nodes.concat(network2.nodes);

   return network1;
 }

/**
 * Create an offspring from two parent networks
 */
 Network.crossOver = function(network1, network2, method){
   /*if(typeof method == 'undefined'){
     throw new Error('No crossover method given!');
   } else if(!method.name in Methods.Crossover){
     throw new Error('This method does not exist!');
   } else */if(network1.input != network2.input || network1.output != network2.output){
     throw new Error("Networks don't have the same input/output size!");
   }

   // Initialise offspring
   var offspring = new Network(network1.input, network1.output);
   offspring.connections = [];
   offspring.nodes = [];

   // Save scores and create a copy
   var score1 = network1.score || 0;
   var score2 = network2.score || 0;
   network1 = Network.fromJSON(network1.toJSON());
   network2 = Network.fromJSON(network2.toJSON());

   // Determine offspring node size
   if(score1 == score2){
     var max = Math.max(network1.nodes.length, network2.nodes.length);
     var min = Math.min(network1.nodes.length, network2.nodes.length);
     var size = Math.floor(Math.random() * (max - min + 1) + min);
   } else if(score1 > score2){
     var size = network1.nodes.length;
   } else {
     var size = network2.nodes.length;
   }

   // Assign nodes from parents to offspring
   for(var i = 0; i < size; i++){
     if(i < network1.nodes.length && i < network2.nodes.length){
       var node = null;
       if(i >= size-network1.output){
         while(node == null || node.type != 'output'){
           if(Math.random() >= 0.5){
             node = network1.nodes[i];
           } else {
             node = network2.nodes[i];
           }
         }
       } else {
         while(node == null || (i < size-network1.output && node.type == 'output')){
           if(Math.random() >= 0.5){
             node = network1.nodes[i];
           } else {
             node = network2.nodes[i];
           }
         }
       }

       offspring.nodes.push(node);
     } else if(i < network1.nodes.length){
       if(i >= size-network1.output){
         offspring.nodes.push(network1.nodes[network1.nodes.length - (i - (size-network1.output - 1))]);
       } else {
         offspring.nodes.push(network1.nodes[i]);
       }
     } else if(i < network2.nodes.length){
       if(i >= size-network1.output){
         offspring.nodes.push(network2.nodes[network2.nodes.length - (i - (size-network1.output - 1))]);
       } else {
         offspring.nodes.push(network2.nodes[i]);
       }
     }
   }

   // Clear the node connections, make a copy
   for(node in offspring.nodes){
     offspring.nodes[node] = Node.fromJSON(offspring.nodes[node].toJSON());
   }

   // Create arrays of connection genes
   var n1conns = {};
   var n2conns = {};

   var n1connections = network1.connections.concat(network1.selfconns);
   for(conn in n1connections){
     var conn = n1connections[conn];
     var data = {
       weight: conn.weight,
       from  : network1.nodes.indexOf(conn.from),
       to    : network1.nodes.indexOf(conn.to),
       gater : network1.nodes.indexOf(conn.gater)
     };
     if(data.to == network1.nodes.length - 1){
       if(data.from < size - 1){
         data.to = size - 1;
       } else {
         continue;
       }
     }
     var id = Connection.innovationID(data.from, data.to);
     n1conns[id] = data;
   }

   var n2connections = network2.connections.concat(network2.selfconns);
   for(conn in n2connections){
     var conn = n2connections[conn];
     var data = {
       weight: conn.weight,
       from  : network2.nodes.indexOf(conn.from),
       to    : network2.nodes.indexOf(conn.to),
       gater : network2.nodes.indexOf(conn.gater)
     };
     if(data.to == network2.nodes.length - 1){
       if(data.from < size - 1){
         data.to = size - 1;
       } else {
         continue;
       }
     }
     var id = Connection.innovationID(data.from, data.to);
     n2conns[id] = data;
   }


   // Split common conn genes from disjoint or excess conn genes
   var commongenes = {};
   for(var id in n1conns) {
     if(id in n2conns) {
       commongenes[id] = [n1conns[id], n2conns[id]];
       delete n1conns[id];
       delete n2conns[id];
     }
   }

   // Create a list of conn genes for the offspring
   var connections = [];
   for(conn in commongenes){
     var conn = Math.random() >= 0.5 ? commongenes[conn][0] : commongenes[conn][1];
     connections.push(conn);
   }

   // Now add conn genes from the fittest parent (or both)
   if(score1 == score2){
     for(conn in n1conns) connections.push(n1conns[conn]);
     for(conn in n2conns) connections.push(n2conns[conn]);
   } else if(score1 > score2){
     for(conn in n1conns) connections.push(n1conns[conn]);
   } else {
     for(conn in n2conns) connections.push(n2conns[conn]);
   }

   // Add common conn genes uniformly
   for(conn in connections){
     var connData = connections[conn];
     if(connData.to < size && connData.from < size){
       var from = offspring.nodes[connData.from];
       var to   = offspring.nodes[connData.to];
       var conn = offspring.connect(from, to)[0];

       conn.weight = connData.weight;

       if(connData.gater != -1 && connData.gater < size){
         offspring.gate(offspring.nodes[connData.gater], conn);
       }
     }
   }
   return offspring;
 }
