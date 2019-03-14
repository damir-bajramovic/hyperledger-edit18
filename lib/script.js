const NEW = 'NEW';
const ON_ROAD = 'ON_ROAD';
const DELIVERED = 'DELIVERED';

const factory = getFactory();

function getUuid() {
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1)
    return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`
}

async function initializeShipment(createShipment) {
	let shipmentRegistry = await getAssetRegistry('org.example.biznet.Shipment');

	let shipment = factory.newResource('org.example.biznet', 'Shipment', getUuid()); 

	// TODO: Check if participants exist!
	shipment.sender = createShipment.sender;
	shipment.recipient = createShipment.recipient;
	shipment.currentHolder = createShipment.sender;
	shipment.value = createShipment.value;
	shipment.description = createShipment.description;
	shipment.shipmentState = NEW;

	await shipmentRegistry.add(shipment);

	return shipment;
}

/**
* CreateShipment transaction handler
* @param {org.example.biznet.CreateShipment} createShipment
* @transaction
*/
async function onCreateShipment(createShipment) {
	const shipment = await initializeShipment(createShipment);

	// Create relationship to that shipment
	const shipmentRelationship = factory.newRelationship('org.example.biznet', 'Shipment', shipment.shipmentId);

	// Push the relationship to adequate arrays of relationships
	shipment.sender.sentShipments.push(shipmentRelationship);
	shipment.recipient.incomingShipments.push(shipmentRelationship);

	// Update participants 
	let clientRegistry = await getParticipantRegistry('org.example.biznet.Client');
	await clientRegistry.update(shipment.sender);
	await clientRegistry.update(shipment.recipient);
}

/**
* TransferShipment transaction handler
* @param {org.example.biznet.TransferShipment} transferShipment
* @transaction
*/
async function onTransferShipment(transferShipment) {
	console.log(transferShipment);
	// Check if the current holder is making the transaction or check if the shipment is delivered
	if (transferShipment.shipment.currentHolder.accountID != transferShipment.from.accountID || 
		transferShipment.shipment.shipmentState == DELIVERED || 
		transferShipment.shipment.currentHolder.accountID == transferShipment.to.accountID)
		throw "Can't send the transaction with the following parameters."; 
	
	const currentShipmentRelationship = getFactory().newRelationship('org.example.biznet', 'Shipment', transferShipment.shipment.shipmentId);


	const filteringFunction = function(value) {
		return value.$identifier !== currentShipmentRelationship.$identifier;
	};
	
	// Remove the shipment from carryingShipments, if the current holder is a transport company 
	const transportCompanyRegistry = await getParticipantRegistry('org.example.biznet.TransportCompany');
	
	if (await transportCompanyRegistry.exists(transferShipment.shipment.currentHolder.accountID)) {
		const currentHolder = await transportCompanyRegistry.get(transferShipment.shipment.currentHolder.accountID);
		currentHolder.carryingShipments = currentHolder.carryingShipments.filter(filteringFunction);
		await transportCompanyRegistry.update(currentHolder);
	}

	// Change current holder 
	transferShipment.shipment.currentHolder = transferShipment.to;
	
	// Push the shipment for tracking purposes of the new trasnport company, if the current holder is a transport company
	if (await transportCompanyRegistry.exists(transferShipment.shipment.currentHolder.accountID)){
		const currentHolder = await transportCompanyRegistry.get(transferShipment.shipment.currentHolder.accountID);
		currentHolder.carryingShipments.push(currentShipmentRelationship);
		await transportCompanyRegistry.update(currentHolder);
	}

	// Check if this is the first transfer of the shipment 
	if (transferShipment.shipment.shipmentState == NEW) 
		transferShipment.shipment.shipmentState = ON_ROAD;

	// Check if the shipment reached the recipient 
	if (transferShipment.shipment.recipient.accountID == transferShipment.shipment.currentHolder.accountID) {
		transferShipment.shipment.shipmentState = DELIVERED;

		transferShipment.shipment.sender.sentShipments = transferShipment.shipment.sender.sentShipments.filter(filteringFunction);
		transferShipment.shipment.recipient.incomingShipments = transferShipment.shipment.recipient.incomingShipments.filter(filteringFunction);
		
		const clientsRegistry = await getParticipantRegistry('org.example.biznet.Client');
		await clientsRegistry.update(transferShipment.shipment.sender);
		await clientsRegistry.update(transferShipment.shipment.recipient);
    }

	// Save changes 
	let assetRegistry = await getAssetRegistry('org.example.biznet.Shipment');
	await assetRegistry.update(transferShipment.shipment);
}